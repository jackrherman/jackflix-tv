'use strict'

// ── CONFIG ────────────────────────────────────────────────────────────────────

const ROWS = [
  { title: 'Trending Now',     endpoint: '/trending/all/week',   type: 'mixed'  },
  { title: 'Popular Movies',   endpoint: '/movie/popular',        type: 'movie'  },
  { title: 'Popular TV Shows', endpoint: '/tv/popular',           type: 'tv'     },
  { title: 'Top Rated Movies', endpoint: '/movie/top_rated',      type: 'movie'  },
  { title: 'Top Rated TV',     endpoint: '/tv/top_rated',         type: 'tv'     },
  { title: 'Action',           endpoint: '/discover/movie',       type: 'movie',
    params: { with_genres: '28',  sort_by: 'popularity.desc' } },
  { title: 'Sci-Fi',           endpoint: '/discover/movie',       type: 'movie',
    params: { with_genres: '878', sort_by: 'popularity.desc' } },
  { title: 'Crime & Thriller', endpoint: '/discover/movie',       type: 'movie',
    params: { with_genres: '80',  sort_by: 'popularity.desc' } },
]

const posterUrl = (p, sz='w342') => p ? `${IMG}/${sz}${p}` : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="330"><rect fill="%23333"/></svg>'
const bdUrl     = (p, sz='w1280')=> p ? `${IMG}/${sz}${p}` : ''
const ttitle    = i => i.title || i.name || 'Unknown'
const year      = i => (i.release_date || i.first_air_date || '').slice(0, 4)
const stars     = i => i.vote_average ? '★ ' + i.vote_average.toFixed(1) : ''
const mtype     = (i, rt) => rt !== 'mixed' ? rt : (i.media_type || 'movie')

// ── FOCUS STATE ───────────────────────────────────────────────────────────────
// Three modes: 'browse' | 'detail' | 'player'
// In browse: focusRow (0-based) and focusCol (0-based per row)

let focusRow     = 0
let focusCol     = 0
let rowData      = []          // parallel to ROWS: each entry is array of items
let activeFilter = 'all'
let filteredRows = []          // which ROWS are visible

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  setupPlayer()
  setupNav()
  setupKeyboard()

  filteredRows = ROWS
  await loadRows()
}

// ── DATA LOADING ──────────────────────────────────────────────────────────────

async function loadRows() {
  document.getElementById('rows').innerHTML = ''
  rowData = []

  const results = await Promise.all(
    filteredRows.map(row =>
      tmdb(row.endpoint, row.params || {}).catch(() => ({ results: [] }))
    )
  )

  filteredRows.forEach((row, ri) => {
    const items = (results[ri]?.results || []).slice(0, 20)
    rowData[ri] = items
  })

  renderRows()
  updateHero()
  focus(0, 0)
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function renderRows() {
  const container = document.getElementById('rows')
  container.innerHTML = ''

  filteredRows.forEach((row, ri) => {
    const items = rowData[ri] || []

    const rowEl = document.createElement('div')
    rowEl.className = 'row'
    rowEl.dataset.row = ri

    const title = document.createElement('div')
    title.className = 'row-title'
    title.textContent = row.title

    const cards = document.createElement('div')
    cards.className = 'row-cards'

    items.forEach((item, ci) => {
      const card = document.createElement('div')
      card.className = 'card'
      card.tabIndex = -1
      card.dataset.row = ri
      card.dataset.col = ci

      const img = document.createElement('img')
      img.src = posterUrl(item.poster_path)
      img.alt = ttitle(item)
      img.loading = 'lazy'

      const label = document.createElement('div')
      label.className = 'card-label'
      label.textContent = ttitle(item)

      card.appendChild(img)
      card.appendChild(label)
      cards.appendChild(card)
    })

    rowEl.appendChild(title)
    rowEl.appendChild(cards)
    container.appendChild(rowEl)
  })
}

// ── HERO ──────────────────────────────────────────────────────────────────────

function updateHero() {
  // Use the first row's first item as hero
  const items = rowData[0] || []
  const item  = items[0]
  if (!item) return

  document.getElementById('heroBg').style.backgroundImage = `url('${bdUrl(item.backdrop_path)}')`
  document.getElementById('heroTitle').textContent    = ttitle(item)
  document.getElementById('heroMeta').textContent     = [year(item), stars(item)].filter(Boolean).join(' · ')
  document.getElementById('heroOverview').textContent = item.overview || ''
}

function updateHeroFromFocus() {
  const item = rowData[focusRow]?.[focusCol]
  if (!item) return
  document.getElementById('heroBg').style.backgroundImage = `url('${bdUrl(item.backdrop_path)}')`
  document.getElementById('heroTitle').textContent    = ttitle(item)
  document.getElementById('heroMeta').textContent     = [year(item), stars(item)].filter(Boolean).join(' · ')
  document.getElementById('heroOverview').textContent = item.overview || ''
}

// ── FOCUS MANAGEMENT ─────────────────────────────────────────────────────────

function focus(row, col) {
  // Clamp
  row = Math.max(0, Math.min(filteredRows.length - 1, row))
  const items = rowData[row] || []
  col = Math.max(0, Math.min(items.length - 1, col || 0))

  focusRow = row
  focusCol = col

  // Remove all focused classes
  document.querySelectorAll('.card.focused').forEach(c => c.classList.remove('focused'))

  // Set focused
  const card = getCard(row, col)
  if (card) {
    card.classList.add('focused')
    scrollRowToCard(row, col)
    scrollBrowseToRow(row)
    updateHeroFromFocus()
  }
}

function getCard(row, col) {
  return document.querySelector(`.card[data-row="${row}"][data-col="${col}"]`)
}

function scrollRowToCard(row, col) {
  const rowEl = document.querySelector(`.row[data-row="${row}"] .row-cards`)
  if (!rowEl) return
  const cardW   = 220 + 16  // card width + gap
  const visible = Math.floor(1920 / cardW) - 1
  const offset  = col > visible ? (col - visible) * cardW : 0
  rowEl.style.transform = `translateX(-${offset}px)`
}

function scrollBrowseToRow(row) {
  const rowsEl  = document.getElementById('rows')
  const rowEl   = document.querySelector(`.row[data-row="${row}"]`)
  if (!rowEl) return
  const rowH    = rowEl.offsetHeight + 48   // height + margin
  const offset  = row * rowH
  const maxShow = 1080 - 540               // space below hero
  const shift   = Math.max(0, offset - maxShow / 2)
  rowsEl.style.transform = `translateY(-${shift}px)`
}

// ── KEYBOARD / D-PAD ─────────────────────────────────────────────────────────

function setupKeyboard() {
  document.addEventListener('keydown', e => {
    // Player takes priority
    if (!document.getElementById('player').classList.contains('hidden')) {
      handlePlayerKey(e)
      return
    }

    // Detail overlay
    if (!document.getElementById('detail').classList.contains('hidden')) {
      handleDetailKey(e)
      return
    }

    // Browse
    handleBrowseKey(e)
  })

  // webOS back button
  document.addEventListener('keydown', e => {
    if (e.keyCode === 461) {
      if (!document.getElementById('detail').classList.contains('hidden')) {
        closeDetail()
      }
    }
  })
}

function handleBrowseKey(e) {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      focus(focusRow + 1, focusCol)
      break
    case 'ArrowUp':
      e.preventDefault()
      focus(focusRow - 1, focusCol)
      break
    case 'ArrowRight':
      e.preventDefault()
      focus(focusRow, focusCol + 1)
      break
    case 'ArrowLeft':
      e.preventDefault()
      focus(focusRow, focusCol - 1)
      break
    case 'Enter':
      e.preventDefault()
      selectCard(focusRow, focusCol)
      break
    case 'Escape':
    case 'BrowserBack':
    case 'GoBack':
      // exit app or go back
      if (typeof window.close === 'function') window.close()
      break
  }
}

// ── SELECT / DETAIL ───────────────────────────────────────────────────────────

function selectCard(row, col) {
  const item = rowData[row]?.[col]
  if (!item) return
  const type = mtype(item, filteredRows[row]?.type)
  showDetail(item, type)
}

function showDetail(item, type) {
  const detail = document.getElementById('detail')
  detail.classList.remove('hidden')

  document.getElementById('detailBg').style.backgroundImage = `url('${bdUrl(item.backdrop_path)}')`
  document.getElementById('detailTitle').textContent    = ttitle(item)
  document.getElementById('detailMeta').textContent     = [year(item), stars(item), type === 'tv' ? 'TV Show' : 'Movie'].filter(Boolean).join(' · ')
  document.getElementById('detailOverview').textContent = item.overview || ''

  // Actions
  const actions = document.getElementById('detailActions')
  actions.innerHTML = ''

  if (type === 'movie') {
    const playBtn = document.createElement('button')
    playBtn.className = 'detail-btn detail-btn-play'
    playBtn.textContent = '▶ Play'
    playBtn.addEventListener('click', () => {
      closeDetail()
      openPlayer({ title: ttitle(item), tmdbId: item.id, type: 'movie' })
    })
    actions.appendChild(playBtn)
    setTimeout(() => playBtn.focus(), 50)
  } else {
    // TV — show episode picker
    const epBtn = document.createElement('button')
    epBtn.className = 'detail-btn detail-btn-tv'
    epBtn.textContent = '▶ Watch'
    epBtn.addEventListener('click', () => loadEpPicker(item))
    actions.appendChild(epBtn)
    document.getElementById('epPicker').classList.add('hidden')
    setTimeout(() => epBtn.focus(), 50)
  }

  detail._item = item
  detail._type = type
}

async function loadEpPicker(item) {
  const picker = document.getElementById('epPicker')
  picker.classList.remove('hidden')

  const data = await tmdb(`/tv/${item.id}`).catch(() => null)
  if (!data) return

  const seasons = (data.seasons || []).filter(s => s.season_number > 0)

  // Season buttons
  const seasonRow = document.getElementById('epSeasonRow')
  seasonRow.innerHTML = ''
  seasons.forEach((s, i) => {
    const btn = document.createElement('button')
    btn.className = 'ep-season-btn' + (i === 0 ? ' active' : '')
    btn.textContent = `Season ${s.season_number}`
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ep-season-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      loadEpisodes(item.id, s.season_number)
    })
    seasonRow.appendChild(btn)
  })

  if (seasons.length) {
    loadEpisodes(item.id, seasons[0].season_number)
    setTimeout(() => seasonRow.firstChild?.focus(), 50)
  }
}

async function loadEpisodes(showId, seasonNum) {
  const data = await tmdb(`/tv/${showId}/season/${seasonNum}`).catch(() => null)
  const list = document.getElementById('epList')
  list.innerHTML = ''
  if (!data) return

  const show = document.getElementById('detail')._item
  ;(data.episodes || []).forEach(ep => {
    const el = document.createElement('div')
    el.className = 'ep-item'
    el.tabIndex = 0

    const img = document.createElement('img')
    img.src = ep.still_path ? `${IMG}/w300${ep.still_path}` : ''
    img.alt = ep.name

    const info = document.createElement('div')
    info.className = 'ep-info'
    const num  = document.createElement('div'); num.className  = 'ep-num';  num.textContent  = `E${ep.episode_number}`
    const name = document.createElement('div'); name.className = 'ep-name'; name.textContent = ep.name

    info.appendChild(num); info.appendChild(name)
    el.appendChild(img); el.appendChild(info)
    list.appendChild(el)

    el.addEventListener('click', () => {
      closeDetail()
      openPlayer({
        title:   `${ttitle(show)}  ·  S${String(seasonNum).padStart(2,'0')}E${String(ep.episode_number).padStart(2,'0')}`,
        tmdbId:  showId,
        type:    'tv',
        season:  seasonNum,
        episode: ep.episode_number,
      })
    })
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') el.click()
    })
  })
}

function closeDetail() {
  document.getElementById('detail').classList.add('hidden')
  document.getElementById('epPicker').classList.add('hidden')
}

function handleDetailKey(e) {
  switch (e.key) {
    case 'Escape':
    case 'GoBack':
    case 'BrowserBack':
      e.preventDefault()
      closeDetail()
      break
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown':
      // Let browser handle focus movement within detail buttons/ep items
      break
  }
}

// ── NAV TABS ──────────────────────────────────────────────────────────────────

function setupNav() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeFilter = tab.dataset.filter
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      filteredRows = activeFilter === 'all'
        ? ROWS
        : ROWS.filter(r => r.type === activeFilter || r.type === 'mixed')
      loadRows()
    })
  })
}

// ── BOOT ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', init)

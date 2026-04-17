'use strict'

// ── CONFIG ────────────────────────────────────────────────────────────────────

const ROWS = [
  { title: 'Trending Now',     endpoint: '/trending/all/week',  type: 'mixed' },
  { title: 'Popular Movies',   endpoint: '/movie/popular',       type: 'movie' },
  { title: 'Popular TV Shows', endpoint: '/tv/popular',          type: 'tv'    },
  { title: 'Top Rated Movies', endpoint: '/movie/top_rated',     type: 'movie' },
  { title: 'Top Rated TV',     endpoint: '/tv/top_rated',        type: 'tv'    },
  { title: 'Action',           endpoint: '/discover/movie',      type: 'movie',
    params: { with_genres: '28',  sort_by: 'popularity.desc' } },
  { title: 'Sci-Fi',           endpoint: '/discover/movie',      type: 'movie',
    params: { with_genres: '878', sort_by: 'popularity.desc' } },
  { title: 'Crime & Thriller', endpoint: '/discover/movie',      type: 'movie',
    params: { with_genres: '80',  sort_by: 'popularity.desc' } },
]

const AVATAR_COLORS = ['#e50914','#0070f3','#10b981','#8b5cf6','#f59e0b','#ec4899','#06b6d4']

// card width + gap for scroll calculations
const CARD_W = 208

// ── STATE ─────────────────────────────────────────────────────────────────────

var activeFilter  = 'all'
var filteredRows  = ROWS.slice()
var rowData       = []   // indexed by filteredRows index
var cwRowData     = []   // CW entries

var focusRow      = 0    // -1 = CW row
var focusCol      = 0

var browseZone    = 'content'  // 'content' | 'nav'
var navFocusIdx   = 0          // 0=Home 1=Movies 2=TV 3=Switch

var modalItem     = null
var modalType     = null
var modalSeason   = 1
var epFocusIdx    = 0
var modalFocusArea = 'play'  // 'play' | 'episodes'

var profiles      = []
var profileFocus  = 0
var pinEntry      = ''
var pinProfile    = null
var pinKeyFocus   = 0

// ── KEYBOARD ──────────────────────────────────────────────────────────────────

function keyName(e) {
  if (e.key && e.key !== 'Unidentified') return e.key
  var m = { 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight',
            40: 'ArrowDown', 13: 'Enter', 27: 'Escape', 8: 'Backspace' }
  return m[e.keyCode] || ''
}

function isBackKey(e) {
  return e.keyCode === 461 || e.key === 'GoBack' || e.key === 'BrowserBack'
}

window.addEventListener('keydown', function(e) {
  if (isBackKey(e)) {
    e.preventDefault()
    e.stopImmediatePropagation()
    handleBack()
    return
  }

  var vpOpen      = !document.getElementById('vpOverlay').classList.contains('hidden')
  var modalOpen   = !document.getElementById('modalOverlay').classList.contains('hidden')
  var profileOpen = !document.getElementById('profileScreen').classList.contains('hidden')

  if (vpOpen)      { handlePlayerKey(e); return }
  if (modalOpen)   { handleModalKey(e);  return }
  if (profileOpen) { handleProfileKey(e); return }
  handleBrowseKey(e)
}, true)  // capture phase

// ── BACK HANDLER ──────────────────────────────────────────────────────────────

function handleBack() {
  var epPanelOpen = !document.getElementById('vpEpPanel').classList.contains('hidden') &&
                    document.getElementById('vpEpPanel').style.transform !== 'translateX(100%)'

  if (!document.getElementById('vpOverlay').classList.contains('hidden')) {
    if (typeof closeEpPanel === 'function' && epPanelOpen) { closeEpPanel(); return }
    if (typeof closePlayer === 'function') closePlayer()
    return
  }
  if (!document.getElementById('modalOverlay').classList.contains('hidden')) {
    closeModal()
    return
  }
  if (!document.getElementById('profileScreen').classList.contains('hidden')) {
    if (!document.getElementById('pinScreen').classList.contains('hidden')) {
      showProfilePicker()
    }
    return  // swallow at profile picker — don't exit app
  }
  if (browseZone === 'nav') {
    browseZone = 'content'
    updateNavFocus()
    focus(focusRow, focusCol)
    return
  }
  // Swallow — never exit app
}

// ── BROWSE NAVIGATION ─────────────────────────────────────────────────────────

function handleBrowseKey(e) {
  if (browseZone === 'nav') { handleNavKey(e); return }
  var key = keyName(e)
  switch (key) {
    case 'ArrowDown':
      e.preventDefault()
      focus(focusRow + 1, focusCol)
      break
    case 'ArrowUp': {
      e.preventDefault()
      var topRow = cwRowData.length > 0 ? -1 : 0
      if (focusRow <= topRow) {
        browseZone = 'nav'
        updateNavFocus()
      } else {
        focus(focusRow - 1, focusCol)
      }
      break
    }
    case 'ArrowRight': e.preventDefault(); focus(focusRow, focusCol + 1); break
    case 'ArrowLeft':  e.preventDefault(); focus(focusRow, focusCol - 1); break
    case 'Enter':      e.preventDefault(); selectCard(focusRow, focusCol); break
  }
}

function handleNavKey(e) {
  var key = keyName(e)
  switch (key) {
    case 'ArrowLeft':
      e.preventDefault()
      navFocusIdx = Math.max(0, navFocusIdx - 1)
      updateNavFocus()
      break
    case 'ArrowRight':
      e.preventDefault()
      navFocusIdx = Math.min(3, navFocusIdx + 1)
      updateNavFocus()
      break
    case 'ArrowDown':
      e.preventDefault()
      browseZone = 'content'
      updateNavFocus()
      focus(focusRow, focusCol)
      break
    case 'ArrowUp':
      e.preventDefault()
      // Already at top — stay in nav
      break
    case 'Enter':
      e.preventDefault()
      if (navFocusIdx === 3) {
        showProfileScreen()
      } else {
        var filters = ['all', 'movie', 'tv']
        applyFilter(filters[navFocusIdx])
        browseZone = 'content'
        updateNavFocus()
      }
      break
  }
}

function updateNavFocus() {
  var inNav = (browseZone === 'nav')
  document.querySelectorAll('.nav-link').forEach(function(el, i) {
    el.classList.toggle('tv-focused', inNav && i === navFocusIdx)
  })
  var sw = document.getElementById('navSwitchBtn')
  if (sw) sw.classList.toggle('tv-focused', inNav && navFocusIdx === 3)
  document.getElementById('nav').classList.toggle('solid', inNav)
}

// ── FILTER ────────────────────────────────────────────────────────────────────

function applyFilter(filter) {
  activeFilter = filter
  document.querySelectorAll('.nav-link').forEach(function(t) {
    t.classList.toggle('active', t.dataset.filter === filter)
  })
  filteredRows = filter === 'all'
    ? ROWS.slice()
    : ROWS.filter(function(r) { return r.type === filter || r.type === 'mixed' })
  loadRows()
}

// ── PROFILE SCREEN ────────────────────────────────────────────────────────────

async function showProfileScreen() {
  document.getElementById('profileScreen').classList.remove('hidden')
  document.getElementById('browse').classList.add('hidden')
  profileFocus = 0
  showLoading()
  await loadProfiles()
  showProfilePicker()
}

function showLoading() {
  document.getElementById('profileLoading').classList.remove('hidden')
  document.getElementById('profilePicker').classList.add('hidden')
  document.getElementById('pinScreen').classList.add('hidden')
}

async function loadProfiles() {
  try {
    var r = await fetch(JF_SERVER + '/api/profiles')
    if (r.ok) {
      var data = await r.json()
      if (Array.isArray(data) && data.length) { profiles = data; return }
    }
  } catch(_) {}
  profiles = [{ id: 'jack', name: 'Jack', avatar: 0, hasPin: false }]
}

function showProfilePicker() {
  if (profiles.length === 1 && !profiles[0].hasPin) {
    enterBrowse()
    return
  }
  document.getElementById('profileLoading').classList.add('hidden')
  document.getElementById('profilePicker').classList.remove('hidden')
  document.getElementById('pinScreen').classList.add('hidden')
  profileFocus = Math.max(0, Math.min(profiles.length - 1, profileFocus))
  renderProfileCards()
}

function renderProfileCards() {
  var container = document.getElementById('profileCards')
  container.innerHTML = ''
  profiles.forEach(function(p, i) {
    var card  = document.createElement('div')
    card.className = 'profile-card' + (i === profileFocus ? ' focused' : '')
    var color = AVATAR_COLORS[p.avatar || (i % AVATAR_COLORS.length)]
    card.innerHTML =
      '<div class="profile-avatar" style="background:' + color + '">' + (p.name || '?')[0].toUpperCase() + '</div>' +
      '<div class="profile-name">' + (p.name || 'Profile') + '</div>'
    container.appendChild(card)
  })
}

function selectProfile() {
  var p = profiles[profileFocus]
  if (!p) return
  if (p.hasPin) showPinScreen(p)
  else enterBrowse()
}

// ── PIN SCREEN ────────────────────────────────────────────────────────────────

function showPinScreen(p) {
  pinProfile = p
  pinEntry   = ''
  pinKeyFocus = 0
  document.getElementById('profilePicker').classList.add('hidden')
  document.getElementById('pinScreen').classList.remove('hidden')
  document.getElementById('pinFor').textContent = 'Enter PIN for ' + p.name
  document.getElementById('pinError').classList.add('hidden')
  updatePinDots()
  buildPinKeypad()
}

function buildPinKeypad() {
  var kp   = document.getElementById('pinKeypad')
  kp.innerHTML = ''
  var keys = ['1','2','3','4','5','6','7','8','9','del','0','ok']
  keys.forEach(function(k, idx) {
    var btn = document.createElement('button')
    btn.className   = 'pin-key' + (idx === pinKeyFocus ? ' focused' : '')
    btn.dataset.k   = k
    btn.dataset.idx = idx
    btn.textContent = k === 'del' ? '\u232b' : k === 'ok' ? '\u2713' : k
    kp.appendChild(btn)
  })
}

function focusPinKey(idx) {
  pinKeyFocus = idx
  document.querySelectorAll('.pin-key').forEach(function(b, i) {
    b.classList.toggle('focused', i === idx)
  })
}

function pressPinKey(k) {
  if (k === 'del') {
    pinEntry = pinEntry.slice(0, -1)
    document.getElementById('pinError').classList.add('hidden')
    updatePinDots()
  } else if (k === 'ok') {
    submitPin()
  } else if (pinEntry.length < 4) {
    pinEntry += k
    updatePinDots()
    if (pinEntry.length === 4) submitPin()
  }
}

function updatePinDots() {
  document.querySelectorAll('.pin-dot').forEach(function(d, i) {
    d.classList.toggle('filled', i < pinEntry.length)
  })
}

async function submitPin() {
  if (!pinProfile) return
  try {
    var r = await fetch(JF_SERVER + '/api/auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ profileId: pinProfile.id, pin: pinEntry }),
    })
    if (r.ok) {
      var data = await r.json()
      if (data.token) {
        localStorage.setItem('jf_tv_token', data.token)
        serverToken = data.token
      }
      enterBrowse()
    } else {
      pinEntry = ''
      updatePinDots()
      document.getElementById('pinError').classList.remove('hidden')
      focusPinKey(0)
    }
  } catch(_) {
    pinEntry = ''
    updatePinDots()
    focusPinKey(0)
  }
}

// ── PROFILE KEY ROUTING ───────────────────────────────────────────────────────

function handleProfileKey(e) {
  var pinVisible = !document.getElementById('pinScreen').classList.contains('hidden')
  if (pinVisible) handlePinKey(e)
  else            handlePickerKey(e)
}

function handlePickerKey(e) {
  var key = keyName(e)
  switch (key) {
    case 'ArrowRight': e.preventDefault(); profileFocus = Math.min(profiles.length - 1, profileFocus + 1); renderProfileCards(); break
    case 'ArrowLeft':  e.preventDefault(); profileFocus = Math.max(0, profileFocus - 1); renderProfileCards(); break
    case 'Enter':      e.preventDefault(); selectProfile(); break
  }
}

function handlePinKey(e) {
  var keys = document.querySelectorAll('.pin-key')
  var cols = 3
  var key  = keyName(e)
  switch (key) {
    case 'ArrowRight': e.preventDefault(); focusPinKey(Math.min(keys.length - 1, pinKeyFocus + 1)); break
    case 'ArrowLeft':  e.preventDefault(); focusPinKey(Math.max(0, pinKeyFocus - 1)); break
    case 'ArrowDown':  e.preventDefault(); focusPinKey(Math.min(keys.length - 1, pinKeyFocus + cols)); break
    case 'ArrowUp':    e.preventDefault(); if (pinKeyFocus >= cols) focusPinKey(pinKeyFocus - cols); break
    case 'Enter':      e.preventDefault(); if (keys[pinKeyFocus]) pressPinKey(keys[pinKeyFocus].dataset.k); break
  }
  // Also support number key shortcuts
  var numMatch = key.match(/^[0-9]$/)
  if (numMatch && key !== 'Enter') { e.preventDefault(); pressPinKey(numMatch[0]) }
}

// ── ENTER BROWSE ──────────────────────────────────────────────────────────────

async function enterBrowse() {
  document.getElementById('profileScreen').classList.add('hidden')
  document.getElementById('browse').classList.remove('hidden')
  browseZone   = 'content'
  filteredRows = ROWS.slice()
  activeFilter = 'all'
  document.querySelectorAll('.nav-link').forEach(function(el) {
    el.classList.toggle('active', el.dataset.filter === 'all')
  })
  await loadCWFromServer()
  await loadRows()
}

// ── DATA LOADING ──────────────────────────────────────────────────────────────

async function loadRows() {
  document.getElementById('rows').innerHTML = ''
  rowData = []

  var results = await Promise.all(
    filteredRows.map(function(row) {
      return tmdb(row.endpoint, row.params || {}).catch(function() { return { results: [] } })
    })
  )

  filteredRows.forEach(function(row, ri) {
    var items = ((results[ri] && results[ri].results) || []).slice(0, 20)
    rowData[ri] = items
  })

  renderRows()
  updateHero()
  focus(0, 0)
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function renderRows() {
  var container = document.getElementById('rows')
  container.innerHTML = ''
  container.style.transform = 'translateY(0)'

  // CW row
  cwRowData = cwRecent()
  if (cwRowData.length) {
    container.appendChild(buildCWRow(cwRowData))
  }

  filteredRows.forEach(function(row, ri) {
    var items = rowData[ri] || []
    if (!items.length) return

    var rowEl = document.createElement('div')
    rowEl.className = 'row'
    rowEl.dataset.row = ri

    var titleEl = document.createElement('div')
    titleEl.className = 'row-title'
    titleEl.textContent = row.title

    var scrollWrap = document.createElement('div')
    scrollWrap.className = 'row-scroll-wrap'

    var cards = document.createElement('div')
    cards.className = 'row-cards'
    cards.dataset.row = ri

    items.forEach(function(item, ci) {
      cards.appendChild(buildCard(item, ri, ci, mtype(item, row.type)))
    })

    scrollWrap.appendChild(cards)
    rowEl.appendChild(titleEl)
    rowEl.appendChild(scrollWrap)
    container.appendChild(rowEl)
  })
}

function buildCWRow(entries) {
  var rowEl = document.createElement('div')
  rowEl.className = 'row'
  rowEl.dataset.row = -1

  var titleEl = document.createElement('div')
  titleEl.className = 'row-title'
  titleEl.textContent = 'Continue Watching'

  var scrollWrap = document.createElement('div')
  scrollWrap.className = 'row-scroll-wrap'

  var cards = document.createElement('div')
  cards.className = 'row-cards'

  entries.forEach(function(e, ci) {
    var card = document.createElement('div')
    card.className = 'card'
    card.dataset.row = -1
    card.dataset.col = ci

    var img = document.createElement('img')
    img.src = posterUrl(e.posterPath)
    img.alt = e.title || ''
    img.loading = 'lazy'

    var overlay = document.createElement('div')
    overlay.className = 'card-overlay'

    var titleEl2 = document.createElement('div')
    titleEl2.className = 'card-title'
    titleEl2.textContent = e.title || ''
    overlay.appendChild(titleEl2)

    if (e.type === 'tv') {
      var epEl = document.createElement('div')
      epEl.className = 'card-ep'
      epEl.textContent = 'S' + String(e.season || 1).padStart(2, '0') + 'E' + String(e.episode || 1).padStart(2, '0')
      overlay.appendChild(epEl)
    }

    var bar  = document.createElement('div'); bar.className = 'cw-bar'
    var fill = document.createElement('div'); fill.className = 'cw-bar-fill'
    fill.style.width = Math.round((e.pct || 0) * 100) + '%'
    bar.appendChild(fill)

    card.appendChild(img)
    card.appendChild(overlay)
    card.appendChild(bar)
    cards.appendChild(card)
  })

  scrollWrap.appendChild(cards)
  rowEl.appendChild(titleEl)
  rowEl.appendChild(scrollWrap)
  return rowEl
}

function buildCard(item, ri, ci, type) {
  var card = document.createElement('div')
  card.className = 'card'
  card.dataset.row = ri
  card.dataset.col = ci

  var p = item.poster_path ? posterUrl(item.poster_path) : ''

  if (p) {
    var img = document.createElement('img')
    img.src = p
    img.alt = ttitle(item)
    img.loading = 'lazy'
    card.appendChild(img)
  } else {
    var noImg = document.createElement('div')
    noImg.className = 'card-no-image'
    noImg.textContent = ttitle(item)
    card.appendChild(noImg)
  }

  var overlay = document.createElement('div')
  overlay.className = 'card-overlay'

  var titleEl = document.createElement('div')
  titleEl.className = 'card-title'
  titleEl.textContent = ttitle(item)

  var ratingEl = document.createElement('div')
  ratingEl.className = 'card-rating'
  ratingEl.textContent = stars(item)

  overlay.appendChild(titleEl)
  overlay.appendChild(ratingEl)
  card.appendChild(overlay)
  return card
}

// ── HERO ──────────────────────────────────────────────────────────────────────

function updateHero() {
  var items = rowData[0] || []
  if (items.length) setHero(items[0], filteredRows[0] && filteredRows[0].type || 'mixed')
}

function setHero(item, rowType) {
  var type = rowType === 'mixed' ? (item.media_type || 'movie') : rowType
  var bd = item.backdrop_path ? (IMG + '/original' + item.backdrop_path) : ''
  document.getElementById('heroBg').style.backgroundImage = bd ? 'url(\'' + bd + '\')' : ''
  document.getElementById('heroBadge').textContent    = type === 'tv' ? 'TV SHOW' : 'FILM'
  document.getElementById('heroTitle').textContent    = ttitle(item)
  document.getElementById('heroOverview').textContent = item.overview || ''
  document.getElementById('heroMeta').innerHTML =
    '<span class="rating">' + stars(item) + '</span><span>' + year(item) + '</span>'
}

function updateHeroFromFocus() {
  var item, rType
  if (focusRow === -1) {
    var e = cwRowData[focusCol]
    if (e) { setHero({ backdrop_path: null, title: e.title, overview: '', vote_average: 0 }, e.type || 'movie') }
    return
  }
  item  = rowData[focusRow] && rowData[focusRow][focusCol]
  rType = filteredRows[focusRow] && filteredRows[focusRow].type || 'mixed'
  if (item) setHero(item, rType)
}

// ── FOCUS MANAGEMENT ─────────────────────────────────────────────────────────

function focus(row, col) {
  var hasCW  = cwRowData.length > 0
  var minRow = hasCW ? -1 : 0
  row = Math.max(minRow, Math.min(filteredRows.length - 1, row))

  var items = row === -1 ? cwRowData : (rowData[row] || [])
  col = Math.max(0, Math.min((items.length || 1) - 1, col || 0))

  focusRow = row
  focusCol = col

  document.querySelectorAll('.card.focused').forEach(function(c) { c.classList.remove('focused') })

  var card = getCard(row, col)
  if (card) {
    card.classList.add('focused')
    scrollRowToCard(row, col)
    scrollContentToRow(row)
    updateHeroFromFocus()
  }
}

function getCard(row, col) {
  return document.querySelector('.card[data-row="' + row + '"][data-col="' + col + '"]')
}

function scrollRowToCard(row, col) {
  var selector = row === -1
    ? '.row[data-row="-1"] .row-cards'
    : '.row[data-row="' + row + '"] .row-cards'
  var rowCards = document.querySelector(selector)
  if (!rowCards) return
  var visibleCols = Math.floor(1920 * 0.88 / CARD_W) - 1  // ~7 visible
  var offset = col > visibleCols ? (col - visibleCols) * CARD_W : 0
  rowCards.style.transform = 'translateX(-' + offset + 'px)'
}

function scrollContentToRow(row) {
  var rowsEl = document.getElementById('rows')
  if (!rowsEl) return
  var hasCW  = cwRowData.length > 0
  var domIdx = hasCW ? (row === -1 ? 0 : row + 1) : Math.max(0, row)

  var top = 0
  for (var i = 0; i < domIdx; i++) {
    var el = rowsEl.children[i]
    if (el) top += el.offsetHeight + 6
  }
  var shift = Math.max(0, top - 40)
  rowsEl.style.transform = 'translateY(-' + shift + 'px)'
}

// ── SELECT CARD ───────────────────────────────────────────────────────────────

function selectCard(row, col) {
  if (row === -1) {
    var e = cwRowData[col]
    if (!e) return
    openPlayer({ title: e.title, tmdbId: e.tmdbId, type: e.type, season: e.season || 1,
                 episode: e.episode || 1, resumeFrom: e.position, posterPath: e.posterPath })
    return
  }
  var item = rowData[row] && rowData[row][col]
  if (!item) return
  var type = mtype(item, (filteredRows[row] && filteredRows[row].type) || 'mixed')
  openModal(item, type)
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

async function openModal(item, type) {
  modalItem      = item
  modalType      = type
  modalFocusArea = 'play'
  epFocusIdx     = 0

  document.getElementById('modalOverlay').classList.remove('hidden')
  document.getElementById('modalBackdrop').src = bdUrl(item.backdrop_path) || posterUrl(item.poster_path, 'w780') || ''
  document.getElementById('modalTitle').textContent    = ttitle(item)
  document.getElementById('modalOverview').textContent = item.overview || ''

  var metaEl = document.getElementById('modalMeta')
  metaEl.innerHTML = ''
  if (item.vote_average) {
    metaEl.innerHTML += '<span class="match">' + Math.round(item.vote_average * 10) + '% Match</span>'
  }
  metaEl.innerHTML += '<span class="year">' + year(item) + '</span>'

  var actionsEl = document.getElementById('modalActions')
  actionsEl.innerHTML = ''
  var playBtn = document.createElement('button')
  playBtn.className = 'btn btn-play'
  playBtn.id = 'modalPlayBtn'
  playBtn.innerHTML = '&#9654; ' + (type === 'tv' ? 'Play S1:E1' : 'Play')
  playBtn.addEventListener('click', function() {
    closeModal()
    openPlayer({ title: ttitle(item) + (type === 'tv' ? ' \u00b7 S01E01' : ''),
                 tmdbId: item.id, type: type, season: 1, episode: 1, posterPath: item.poster_path })
  })
  actionsEl.appendChild(playBtn)

  document.getElementById('modalSide').innerHTML = ''
  document.getElementById('episodesSection').classList.add('hidden')

  updateModalFocus()

  try {
    var ep   = type === 'tv' ? '/tv/' + item.id : '/movie/' + item.id
    var data = await tmdb(ep, { append_to_response: 'credits' })

    if (data.runtime) {
      metaEl.innerHTML += '<span class="runtime">' + data.runtime + 'm</span>'
    } else if (type === 'tv' && data.number_of_seasons) {
      metaEl.innerHTML += '<span class="runtime">' + data.number_of_seasons + ' Season' + (data.number_of_seasons > 1 ? 's' : '') + '</span>'
    }

    var credits = data.credits || {}
    var cast = (credits.cast || []).slice(0, 5).map(function(c) { return c.name }).join(', ')
    var dir  = (credits.crew || []).find(function(c) { return c.job === 'Director' })
    var gen  = (data.genres || []).map(function(g) { return g.name }).join(', ')
    var side = ''
    if (cast) side += '<div><span style="color:var(--muted)">Cast: </span>' + cast + '</div>'
    if (dir)  side += '<div><span style="color:var(--muted)">Director: </span>' + dir.name + '</div>'
    if (gen)  side += '<div><span style="color:var(--muted)">Genres: </span>' + gen + '</div>'
    document.getElementById('modalSide').innerHTML = side

    if (type === 'tv') {
      var seasons = (data.seasons || []).filter(function(s) { return s.season_number > 0 })
      if (seasons.length) {
        buildSeasonSelect(seasons, item.id)
        loadModalEpisodes(item.id, seasons[0].season_number)
        document.getElementById('episodesSection').classList.remove('hidden')
      }
    }
  } catch(_) {}
}

function buildSeasonSelect(seasons, tmdbId) {
  var sel = document.getElementById('seasonSelect')
  sel.innerHTML = ''
  seasons.forEach(function(s) {
    var opt = document.createElement('option')
    opt.value = s.season_number
    opt.textContent = 'Season ' + s.season_number
    sel.appendChild(opt)
  })
  sel.addEventListener('change', function() {
    loadModalEpisodes(tmdbId, parseInt(sel.value))
    epFocusIdx = 0
  })
}

async function loadModalEpisodes(showId, seasonNum) {
  modalSeason = seasonNum
  epFocusIdx  = 0
  var list = document.getElementById('episodeList')
  list.innerHTML = '<div class="spinner"></div>'

  try {
    var data = await tmdb('/tv/' + showId + '/season/' + seasonNum)
    list.innerHTML = ''
    ;(data.episodes || []).forEach(function(ep, idx) {
      var el = document.createElement('div')
      el.className  = 'episode-card'
      el.dataset.ep = idx

      var thumbWrap = document.createElement('div')
      thumbWrap.className = 'episode-thumb-wrap'

      if (ep.still_path) {
        var img = document.createElement('img')
        img.src = IMG + '/w300' + ep.still_path
        img.alt = ep.name || ''
        thumbWrap.appendChild(img)
      }

      var playIco = document.createElement('div')
      playIco.className   = 'episode-play-icon'
      playIco.textContent = '▶'
      thumbWrap.appendChild(playIco)

      var info   = document.createElement('div'); info.className = 'episode-info'
      var header = document.createElement('div'); header.className = 'episode-header'
      var num    = document.createElement('div'); num.className = 'episode-num'
      num.textContent = ep.episode_number + '.'
      var name   = document.createElement('div'); name.className = 'episode-title'
      name.textContent = ep.name || 'Episode ' + ep.episode_number
      var rt     = document.createElement('div'); rt.className = 'episode-runtime'
      if (ep.runtime) rt.textContent = ep.runtime + 'm'
      header.appendChild(num); header.appendChild(name); header.appendChild(rt)

      var desc = document.createElement('div'); desc.className = 'episode-desc'
      desc.textContent = ep.overview || ''

      info.appendChild(header); info.appendChild(desc)
      el.appendChild(thumbWrap); el.appendChild(info)
      list.appendChild(el)

      el.addEventListener('click', function() {
        closeModal()
        openPlayer({
          title:     ttitle(modalItem) + ' \u00b7 S' + String(seasonNum).padStart(2,'0') + 'E' + String(ep.episode_number).padStart(2,'0'),
          tmdbId:    showId,
          type:      'tv',
          season:    seasonNum,
          episode:   ep.episode_number,
          posterPath: modalItem && modalItem.poster_path,
        })
      })
    })
    if (modalFocusArea === 'episodes') updateModalFocus()
  } catch(_) {
    list.innerHTML = ''
  }
}

function updateModalFocus() {
  var pb = document.getElementById('modalPlayBtn')
  if (pb) pb.classList.toggle('tv-focused', modalFocusArea === 'play')

  document.querySelectorAll('.episode-card').forEach(function(c, i) {
    c.classList.toggle('focused', modalFocusArea === 'episodes' && i === epFocusIdx)
  })

  if (modalFocusArea === 'episodes') {
    var focused = document.querySelectorAll('.episode-card')[epFocusIdx]
    if (focused) focused.scrollIntoView({ block: 'nearest' })
  }
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden')
  modalItem = null
}

function handleModalKey(e) {
  var key = keyName(e)
  switch (key) {
    case 'Escape':
      e.preventDefault()
      closeModal()
      break
    case 'ArrowDown': {
      e.preventDefault()
      var cards = document.querySelectorAll('.episode-card')
      if (modalFocusArea === 'play') {
        if (cards.length) { modalFocusArea = 'episodes'; epFocusIdx = 0; updateModalFocus() }
      } else {
        if (epFocusIdx < cards.length - 1) { epFocusIdx++; updateModalFocus() }
      }
      break
    }
    case 'ArrowUp': {
      e.preventDefault()
      if (modalFocusArea === 'episodes') {
        if (epFocusIdx > 0) { epFocusIdx--; updateModalFocus() }
        else { modalFocusArea = 'play'; updateModalFocus() }
      }
      break
    }
    case 'Enter': {
      e.preventDefault()
      if (modalFocusArea === 'play') {
        var pb = document.getElementById('modalPlayBtn')
        if (pb) pb.click()
      } else {
        var focusedCard = document.querySelectorAll('.episode-card')[epFocusIdx]
        if (focusedCard) focusedCard.click()
      }
      break
    }
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  setupPlayer()
  await showProfileScreen()
}

init()

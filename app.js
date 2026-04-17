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

const AVATAR_COLORS = ['#e50914','#0070f3','#10b981','#8b5cf6','#f59e0b','#ec4899','#06b6d4','#84cc16']

const posterUrl = function(p, sz) { sz = sz || 'w342'; return p ? (IMG + '/' + sz + p) : '' }
const bdUrl     = function(p, sz) { sz = sz || 'w1280'; return p ? (IMG + '/' + sz + p) : '' }
const ttitle    = function(i) { return i.title || i.name || 'Unknown' }
const year      = function(i) { return (i.release_date || i.first_air_date || '').slice(0, 4) }
const stars     = function(i) { return i.vote_average ? '\u2605 ' + i.vote_average.toFixed(1) : '' }
const mtype     = function(i, rt) { return rt !== 'mixed' ? rt : (i.media_type || 'movie') }

// ── BROWSE STATE ──────────────────────────────────────────────────────────────

var focusRow     = 0
var focusCol     = 0
var rowData      = []
var cwRowData    = []
var activeFilter = 'all'
var filteredRows = ROWS.slice()

// ── PROFILE STATE ─────────────────────────────────────────────────────────────

var _profiles     = []
var _profileFocus = 0
var _pinEntry     = ''
var _pinProfile   = null
var _pinFocusIdx  = 0

// ── MODAL STATE ───────────────────────────────────────────────────────────────

var _modalItem    = null
var _modalType    = null
var _modalFocusEl = null   // which element had focus before modal
var _modalSeason  = 1
var _epFocusIdx   = 0
var _modalFocusArea = 'play'  // 'play' | 'info' | 'episodes' | 'close'

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  setupPlayer()
  setupKeyboard()
  await showProfileScreen()
}

// ── PROFILE SCREEN ────────────────────────────────────────────────────────────

async function showProfileScreen() {
  document.getElementById('profileScreen').classList.remove('hidden')
  document.getElementById('browse').style.visibility = 'hidden'
  _profileFocus = 0
  await loadProfiles()
  showProfilePicker()
}

async function loadProfiles() {
  try {
    var r = await fetch(JF_SERVER + '/api/profiles', {
      headers: { 'x-jackflix-pin': JF_PIN },
    })
    if (r.ok) {
      var data = await r.json()
      if (Array.isArray(data) && data.length) { _profiles = data; return }
    }
  } catch(_) {}
  // Fallback: hardcoded jack profile so the TV always has someone to log in as
  _profiles = [{ id: 'jack', name: 'Jack', avatar: 0, hasPin: false }]
}

function showProfilePicker() {
  // Skip picker entirely if only one profile with no PIN
  if (_profiles.length === 1 && !_profiles[0].hasPin) {
    loginDirect(_profiles[0])
    return
  }
  document.getElementById('profilePicker').classList.remove('hidden')
  document.getElementById('pinScreen').classList.add('hidden')
  renderProfileCards()
}

function renderProfileCards() {
  var container = document.getElementById('profileCards')
  container.innerHTML = ''
  _profiles.forEach(function(p, i) {
    var card  = document.createElement('div')
    card.className = 'profile-card-tv' + (i === _profileFocus ? ' focused' : '')
    var color = AVATAR_COLORS[p.avatar || 0]
    card.innerHTML =
      '<div class="profile-avatar-tv" style="background:' + color + '">' + p.name[0].toUpperCase() + '</div>' +
      '<div class="profile-name-tv">' + p.name + '</div>'
    container.appendChild(card)
  })
}

function profilePickerSelect() {
  var p = _profiles[_profileFocus]
  if (!p) return
  if (p.hasPin) {
    showPinScreen(p)
  } else {
    loginDirect(p)
  }
}

function loginDirect(p) {
  enterBrowse()
  getJfToken().catch(function() {})  // auth in background; CW sync happens after
}

// ── PIN SCREEN ────────────────────────────────────────────────────────────────

function showPinScreen(p) {
  _pinProfile  = p
  _pinEntry    = ''
  _pinFocusIdx = 0
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
    btn.className   = 'pin-key-tv' + (idx === _pinFocusIdx ? ' active' : '')
    btn.dataset.k   = k
    btn.dataset.idx = idx
    btn.textContent = k === 'del' ? '\u232b' : k === 'ok' ? '\u2713' : k
    kp.appendChild(btn)
  })
}

function focusPinKey(idx) {
  _pinFocusIdx = idx
  document.querySelectorAll('.pin-key-tv').forEach(function(b, i) {
    b.classList.toggle('active', i === idx)
  })
}

function onPinKeyPress(k) {
  if (k === 'del') {
    _pinEntry = _pinEntry.slice(0, -1)
    document.getElementById('pinError').classList.add('hidden')
    updatePinDots()
  } else if (k === 'ok') {
    submitPin()
  } else if (_pinEntry.length < 4) {
    _pinEntry += k
    updatePinDots()
    if (_pinEntry.length === 4) submitPin()
  }
}

function updatePinDots() {
  document.querySelectorAll('.pin-dot-tv').forEach(function(d, i) {
    d.classList.toggle('filled', i < _pinEntry.length)
  })
}

async function submitPin() {
  if (!_pinProfile) return
  try {
    var r = await fetch(JF_SERVER + '/api/auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ profileId: _pinProfile.id, pin: _pinEntry }),
    })
    if (r.ok) {
      var data = await r.json()
      localStorage.setItem('jf_tv_token', data.token)
      serverToken = data.token
      enterBrowse()
    } else {
      _pinEntry = ''
      updatePinDots()
      document.getElementById('pinError').classList.remove('hidden')
      focusPinKey(0)
    }
  } catch(_) {
    _pinEntry = ''
    updatePinDots()
    focusPinKey(0)
  }
}

// ── ENTER BROWSE ──────────────────────────────────────────────────────────────

async function enterBrowse() {
  document.getElementById('profileScreen').classList.add('hidden')
  document.getElementById('browse').style.visibility = 'visible'
  filteredRows = ROWS.slice()
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

  var cwEntries = cwRecent()
  if (cwEntries.length) {
    container.appendChild(buildCWRow(cwEntries))
  }

  filteredRows.forEach(function(row, ri) {
    var items = rowData[ri] || []
    var rowEl = document.createElement('div')
    rowEl.className = 'row'
    rowEl.dataset.row = ri

    var titleEl = document.createElement('div')
    titleEl.className = 'row-title'
    titleEl.textContent = row.title

    var cards = document.createElement('div')
    cards.className = 'row-cards'
    cards.dataset.row = ri

    items.forEach(function(item, ci) {
      cards.appendChild(buildCard(item, ri, ci, row.type))
    })

    rowEl.appendChild(titleEl)
    rowEl.appendChild(cards)
    container.appendChild(rowEl)
  })
}

function buildCard(item, ri, ci, rowType) {
  var card = document.createElement('div')
  card.className = 'card'
  card.dataset.row = ri
  card.dataset.col = ci

  var img = document.createElement('img')
  img.src = posterUrl(item.poster_path)
  img.alt = ttitle(item)
  img.loading = 'lazy'

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
  card.appendChild(img)
  card.appendChild(overlay)
  return card
}

// ── CONTINUE WATCHING ROW ─────────────────────────────────────────────────────

function buildCWRow(entries) {
  cwRowData = entries

  var rowEl = document.createElement('div')
  rowEl.className = 'row'
  rowEl.dataset.row = -1

  var titleEl = document.createElement('div')
  titleEl.className = 'row-title'
  titleEl.textContent = 'Continue Watching'

  var cards = document.createElement('div')
  cards.className = 'row-cards'

  entries.forEach(function(e, ci) {
    var card = document.createElement('div')
    card.className = 'card'
    card.dataset.row = -1
    card.dataset.col = ci

    var img = document.createElement('img')
    img.src = posterUrl(e.posterPath)
    img.alt = e.title

    var overlay = document.createElement('div')
    overlay.className = 'card-overlay'

    var titleEl2 = document.createElement('div')
    titleEl2.className = 'card-title'
    titleEl2.textContent = e.title

    if (e.type === 'tv') {
      var epEl = document.createElement('div')
      epEl.className = 'card-ep'
      epEl.textContent = 'S' + e.season + 'E' + e.episode
      overlay.appendChild(titleEl2)
      overlay.appendChild(epEl)
    } else {
      overlay.appendChild(titleEl2)
    }

    var bar = document.createElement('div')
    bar.className = 'cw-bar'
    var fill = document.createElement('div')
    fill.className = 'cw-bar-fill'
    fill.style.width = Math.round(e.pct * 100) + '%'
    bar.appendChild(fill)

    card.appendChild(img)
    card.appendChild(overlay)
    card.appendChild(bar)
    cards.appendChild(card)
  })

  rowEl.appendChild(titleEl)
  rowEl.appendChild(cards)
  return rowEl
}

// ── HERO ──────────────────────────────────────────────────────────────────────

function updateHero() {
  var items = rowData[0] || []
  if (items[0]) setHero(items[0])
}

function updateHeroFromFocus() {
  var item
  if (focusRow === -1) {
    item = cwRowData[focusCol]
  } else {
    item = rowData[focusRow] && rowData[focusRow][focusCol]
  }
  if (item) setHero(item)
}

function setHero(item) {
  document.getElementById('heroBg').style.backgroundImage = 'url(\'' + bdUrl(item.backdrop_path) + '\')'
  document.getElementById('heroTitle').textContent    = ttitle(item)
  document.getElementById('heroMeta').textContent     = [year(item), stars(item)].filter(Boolean).join(' \u00b7 ')
  document.getElementById('heroOverview').textContent = item.overview || ''
}

// ── FOCUS MANAGEMENT ─────────────────────────────────────────────────────────

function focus(row, col) {
  var hasCW  = cwRowData.length > 0
  var minRow = hasCW ? -1 : 0
  row = Math.max(minRow, Math.min(filteredRows.length - 1, row))

  var items = row === -1 ? cwRowData : (rowData[row] || [])
  col = Math.max(0, Math.min(items.length - 1, col || 0))

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
  var selector = '.row[data-row="' + row + '"] .row-cards'
  var rowEl    = document.querySelector(selector)
  if (!rowEl) return
  var cardW   = 220 + 8
  var visible = Math.floor(1920 * 0.92 / cardW) - 1
  var offset  = col > visible ? (col - visible) * cardW : 0
  rowEl.style.transform = 'translateX(-' + offset + 'px)'
}

function scrollContentToRow(row) {
  var rowsEl = document.getElementById('rows')
  var hasCW  = cwRowData.length > 0
  var domIdx = hasCW ? (row === -1 ? 0 : row + 1) : (row < 0 ? 0 : row)
  var rowEl  = rowsEl.children[domIdx]
  if (!rowEl) return
  var rowH   = rowEl.offsetHeight + 8
  var shift  = Math.max(0, domIdx * rowH - 40)
  rowsEl.style.transform = 'translateY(-' + shift + 'px)'
}

// ── KEYBOARD / D-PAD ─────────────────────────────────────────────────────────

function keyName(e) {
  if (e.key) return e.key
  var m = { 37:'ArrowLeft', 38:'ArrowUp', 39:'ArrowRight', 40:'ArrowDown', 13:'Enter', 27:'Escape' }
  return m[e.keyCode] || ''
}

function setupKeyboard() {
  document.addEventListener('keydown', function(e) {
    // webOS back key — always prevent default so the app never exits
    if (e.keyCode === 461) {
      e.preventDefault()
      if (!document.getElementById('vpOverlay').classList.contains('hidden')) {
        return  // player.js handles this
      }
      if (!document.getElementById('modalOverlay').classList.contains('hidden')) {
        closeModal(); return
      }
      if (!document.getElementById('pinScreen').classList.contains('hidden')) {
        showProfilePicker(); return
      }
      // In browse or profile picker: swallow the event (don't exit app)
      return
    }

    if (!document.getElementById('vpOverlay').classList.contains('hidden')) {
      handlePlayerKey(e); return
    }
    if (!document.getElementById('modalOverlay').classList.contains('hidden')) {
      handleModalKey(e); return
    }
    if (!document.getElementById('profileScreen').classList.contains('hidden')) {
      handleProfileKey(e); return
    }
    handleBrowseKey(e)
  })
}

function handleProfileKey(e) {
  var pinVisible = !document.getElementById('pinScreen').classList.contains('hidden')
  if (pinVisible) {
    handlePinKey(e)
  } else {
    handlePickerKey(e)
  }
}

function handlePickerKey(e) {
  switch (keyName(e)) {
    case 'ArrowRight':
      e.preventDefault()
      _profileFocus = Math.min(_profiles.length - 1, _profileFocus + 1)
      renderProfileCards()
      break
    case 'ArrowLeft':
      e.preventDefault()
      _profileFocus = Math.max(0, _profileFocus - 1)
      renderProfileCards()
      break
    case 'Enter':
      e.preventDefault()
      profilePickerSelect()
      break
  }
}

function handlePinKey(e) {
  var keys = document.querySelectorAll('.pin-key-tv')
  var cols = 3
  switch (keyName(e)) {
    case 'ArrowRight': e.preventDefault(); focusPinKey(Math.min(keys.length - 1, _pinFocusIdx + 1)); break
    case 'ArrowLeft':  e.preventDefault(); focusPinKey(Math.max(0, _pinFocusIdx - 1)); break
    case 'ArrowDown':  e.preventDefault(); focusPinKey(Math.min(keys.length - 1, _pinFocusIdx + cols)); break
    case 'ArrowUp':    e.preventDefault(); if (_pinFocusIdx >= cols) focusPinKey(_pinFocusIdx - cols); break
    case 'Enter':      e.preventDefault(); if (keys[_pinFocusIdx]) onPinKeyPress(keys[_pinFocusIdx].dataset.k); break
    case 'Escape':     e.preventDefault(); _pinEntry = ''; showProfilePicker(); break
  }
}

function handleBrowseKey(e) {
  switch (keyName(e)) {
    case 'ArrowDown':  e.preventDefault(); focus(focusRow + 1, focusCol); break
    case 'ArrowUp':    e.preventDefault(); focus(focusRow - 1, focusCol); break
    case 'ArrowRight': e.preventDefault(); focus(focusRow, focusCol + 1); break
    case 'ArrowLeft':  e.preventDefault(); focus(focusRow, focusCol - 1); break
    case 'Enter':      e.preventDefault(); selectCard(focusRow, focusCol); break
  }
}

// ── SELECT CARD ───────────────────────────────────────────────────────────────

function selectCard(row, col) {
  if (row === -1) {
    var e = cwRowData[col]
    if (!e) return
    openPlayer({ title: e.title, tmdbId: e.tmdbId, type: e.type, season: e.season, episode: e.episode, resumeFrom: e.position })
    return
  }
  var item = rowData[row] && rowData[row][col]
  if (!item) return
  var type = mtype(item, filteredRows[row] && filteredRows[row].type)
  openModal(item, type)
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

async function openModal(item, type) {
  _modalItem       = item
  _modalType       = type
  _modalFocusArea  = 'play'
  _epFocusIdx      = 0

  var overlay = document.getElementById('modalOverlay')
  overlay.classList.remove('hidden')

  // Backdrop
  var bd = document.getElementById('modalBackdrop')
  bd.src = bdUrl(item.backdrop_path) || posterUrl(item.poster_path, 'w780')
  bd.alt = ttitle(item)

  document.getElementById('modalTitle').textContent = ttitle(item)
  document.getElementById('modalOverview').textContent = item.overview || ''

  // Meta
  var metaEl = document.getElementById('modalMeta')
  metaEl.innerHTML = ''
  if (item.vote_average) {
    var matchEl = document.createElement('span'); matchEl.className = 'match'
    matchEl.textContent = Math.round(item.vote_average * 10) + '% Match'
    metaEl.appendChild(matchEl)
  }
  if (year(item)) {
    var yearEl = document.createElement('span'); yearEl.className = 'year'
    yearEl.textContent = year(item)
    metaEl.appendChild(yearEl)
  }

  // Actions
  var actionsEl = document.getElementById('modalActions')
  actionsEl.innerHTML = ''

  if (type === 'movie') {
    var playBtn = document.createElement('button')
    playBtn.className = 'btn btn-play'
    playBtn.id = 'modalPlayBtn'
    playBtn.innerHTML = '&#9654; Play'
    playBtn.addEventListener('click', function() {
      closeModal()
      openPlayer({ title: ttitle(item), tmdbId: item.id, type: 'movie', posterPath: item.poster_path })
    })
    actionsEl.appendChild(playBtn)
  } else {
    var watchBtn = document.createElement('button')
    watchBtn.className = 'btn btn-play'
    watchBtn.id = 'modalPlayBtn'
    watchBtn.innerHTML = '&#9654; Watch'
    watchBtn.addEventListener('click', function() { _modalFocusArea = 'episodes' })
    actionsEl.appendChild(watchBtn)
  }

  // Side info from TMDB details
  var sideEl = document.getElementById('modalSide')
  sideEl.innerHTML = ''

  document.getElementById('episodesSection').classList.add('hidden')

  try {
    var ep   = type === 'tv' ? '/tv/' + item.id : '/movie/' + item.id
    var data = await tmdb(ep, { append_to_response: 'credits' })

    if (data.runtime) {
      var runtimeEl = document.createElement('span'); runtimeEl.className = 'runtime'
      runtimeEl.textContent = data.runtime + 'm'
      metaEl.appendChild(runtimeEl)
    }

    var cast = ((data.credits && data.credits.cast) || []).slice(0, 4).map(function(c) { return c.name }).join(', ')
    var dir  = ((data.credits && data.credits.crew) || []).find(function(c) { return c.job === 'Director' })
    var gen  = (data.genres || []).map(function(g) { return g.name }).join(', ')

    if (cast) sideEl.innerHTML += '<div>Cast: <span>' + cast + '</span></div>'
    if (dir)  sideEl.innerHTML += '<div>Director: <span>' + dir.name + '</span></div>'
    if (gen)  sideEl.innerHTML += '<div>Genres: <span>' + gen + '</span></div>'

    if (type === 'tv') {
      var seasons = (data.seasons || []).filter(function(s) { return s.season_number > 0 })
      if (seasons.length) {
        buildSeasonSelect(seasons, item)
        loadModalEpisodes(item.id, seasons[0].season_number)
        document.getElementById('episodesSection').classList.remove('hidden')
      }
    }
  } catch(_) {}
}

function buildSeasonSelect(seasons, item) {
  var sel = document.getElementById('seasonSelect')
  sel.innerHTML = ''
  seasons.forEach(function(s) {
    var opt = document.createElement('option')
    opt.value = s.season_number
    opt.textContent = 'Season ' + s.season_number
    sel.appendChild(opt)
  })
  sel.addEventListener('change', function() {
    loadModalEpisodes(item.id, +sel.value)
    _epFocusIdx = 0
  })
}

async function loadModalEpisodes(showId, seasonNum) {
  _modalSeason = seasonNum
  _epFocusIdx  = 0
  var data = await tmdb('/tv/' + showId + '/season/' + seasonNum).catch(function() { return null })
  var list = document.getElementById('episodeList')
  list.innerHTML = ''
  if (!data) return

  var show = _modalItem
  ;(data.episodes || []).forEach(function(ep, idx) {
    var el = document.createElement('div')
    el.className  = 'episode-card'
    el.dataset.ep = idx
    el.tabIndex   = 0

    var thumbWrap = document.createElement('div')
    thumbWrap.className = 'episode-thumb-wrap'
    var img = document.createElement('img')
    img.src = ep.still_path ? (IMG + '/w300' + ep.still_path) : ''
    img.alt = ep.name
    var playIcon = document.createElement('div')
    playIcon.className  = 'episode-play-icon'
    playIcon.textContent = '▶'
    thumbWrap.appendChild(img)
    thumbWrap.appendChild(playIcon)

    var info   = document.createElement('div'); info.className = 'episode-info'
    var header = document.createElement('div'); header.className = 'episode-header'
    var num    = document.createElement('div'); num.className = 'episode-num'; num.textContent = ep.episode_number + '.'
    var name   = document.createElement('div'); name.className = 'episode-title'; name.textContent = ep.name
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
        title:   ttitle(show) + ' \u00b7 S' + String(seasonNum).padStart(2,'0') + 'E' + String(ep.episode_number).padStart(2,'0'),
        tmdbId:  showId,
        type:    'tv',
        season:  seasonNum,
        episode: ep.episode_number,
        posterPath: show.poster_path,
      })
    })
  })

  updateEpFocus()
}

function updateEpFocus() {
  var cards = document.querySelectorAll('.episode-card')
  cards.forEach(function(c, i) { c.classList.toggle('focused', i === _epFocusIdx) })
  var focused = cards[_epFocusIdx]
  if (focused) focused.scrollIntoView({ block: 'nearest' })
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden')
  _modalItem = null
}

function handleModalKey(e) {
  switch (keyName(e)) {
    case 'Escape': case 'GoBack': case 'BrowserBack':
      e.preventDefault()
      closeModal()
      break
    case 'ArrowDown': {
      e.preventDefault()
      var cards = document.querySelectorAll('.episode-card')
      if (cards.length && _modalFocusArea === 'episodes') {
        _epFocusIdx = Math.min(cards.length - 1, _epFocusIdx + 1)
        updateEpFocus()
      } else if (_modalFocusArea === 'play' && cards.length) {
        _modalFocusArea = 'episodes'
        updateEpFocus()
      }
      break
    }
    case 'ArrowUp': {
      e.preventDefault()
      if (_modalFocusArea === 'episodes' && _epFocusIdx > 0) {
        _epFocusIdx--
        updateEpFocus()
      } else if (_modalFocusArea === 'episodes' && _epFocusIdx === 0) {
        _modalFocusArea = 'play'
        document.querySelectorAll('.episode-card').forEach(function(c) { c.classList.remove('focused') })
        var pb = document.getElementById('modalPlayBtn')
        if (pb) pb.focus()
      }
      break
    }
    case 'Enter': {
      e.preventDefault()
      if (_modalFocusArea === 'play') {
        var pb = document.getElementById('modalPlayBtn')
        if (pb) pb.click()
      } else if (_modalFocusArea === 'episodes') {
        var cards = document.querySelectorAll('.episode-card')
        if (cards[_epFocusIdx]) cards[_epFocusIdx].click()
      }
      break
    }
    case 'ArrowLeft': case 'ArrowRight': break
  }
}

// ── NAV TABS ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.nav-link').forEach(function(tab) {
    tab.addEventListener('click', function() {
      activeFilter = tab.dataset.filter
      document.querySelectorAll('.nav-link').forEach(function(t) { t.classList.remove('active') })
      tab.classList.add('active')
      filteredRows = activeFilter === 'all'
        ? ROWS.slice()
        : ROWS.filter(function(r) { return r.type === activeFilter || r.type === 'mixed' })
      loadRows()
    })
  })
})

// ── BOOT ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', init)

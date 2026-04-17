'use strict'

// ── CONFIG ────────────────────────────────────────────────────────────────────

const ROWS = [
  { title: 'Continue Watching',  endpoint: null,                    type: 'cw'     },
  { title: 'Trending Now',       endpoint: '/trending/all/week',    type: 'mixed'  },
  { title: 'Popular Movies',     endpoint: '/movie/popular',        type: 'movie'  },
  { title: 'Popular TV Shows',   endpoint: '/tv/popular',           type: 'tv'     },
  { title: 'Top Rated Movies',   endpoint: '/movie/top_rated',      type: 'movie'  },
  { title: 'Top Rated TV',       endpoint: '/tv/top_rated',         type: 'tv'     },
  { title: 'Action',             endpoint: '/discover/movie',       type: 'movie',
    params: { with_genres: '28',  sort_by: 'popularity.desc' } },
  { title: 'Sci-Fi',             endpoint: '/discover/movie',       type: 'movie',
    params: { with_genres: '878', sort_by: 'popularity.desc' } },
  { title: 'Crime & Thriller',   endpoint: '/discover/movie',       type: 'movie',
    params: { with_genres: '80',  sort_by: 'popularity.desc' } },
]

const CONTENT_ROWS = ROWS.filter(function(r) { return r.endpoint !== null })

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
var rowData      = []   // indexed by content row index (CW row = -1)
var cwRowData    = []
var activeFilter = 'all'
var filteredRows = CONTENT_ROWS.slice()

// 'content' or 'nav' — whether D-pad is controlling rows or the top nav bar
var _browseZone  = 'content'
var _navFocusIdx = 0   // 0=Home 1=Movies 2=TV 3=SwitchProfile

// ── PROFILE STATE ─────────────────────────────────────────────────────────────

var _profiles     = []
var _profileFocus = 0
var _pinEntry     = ''
var _pinProfile   = null
var _pinFocusIdx  = 0

// ── MODAL STATE ───────────────────────────────────────────────────────────────

var _modalItem      = null
var _modalType      = null
var _modalSeason    = 1
var _epFocusIdx     = 0
var _modalFocusArea = 'play'  // 'play' | 'episodes'

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  // One-time flush of stale test CW data from localStorage.
  // Server CW is the source of truth; we'll repopulate from there on login.
  if (!localStorage.getItem('jf_cw_flushed_v3')) {
    localStorage.removeItem('cineb_cw')
    localStorage.removeItem('jf_tv_cw')
    localStorage.setItem('jf_cw_flushed_v3', '1')
  }
  setupPlayer()
  setupKeyboard()
  await showProfileScreen()
}

// ── KEYBOARD ──────────────────────────────────────────────────────────────────

function keyName(e) {
  if (e.key && e.key !== 'Unidentified') return e.key
  var m = { 37:'ArrowLeft', 38:'ArrowUp', 39:'ArrowRight', 40:'ArrowDown', 13:'Enter', 27:'Escape', 8:'Backspace' }
  return m[e.keyCode] || ''
}

function isBackKey(e) {
  return e.keyCode === 461 || e.key === 'GoBack' || e.key === 'BrowserBack'
}

function setupKeyboard() {
  // Capture phase + stopImmediatePropagation ensures the back button is always
  // trapped by us before webOS can process it as an app-exit gesture.
  window.addEventListener('keydown', function(e) {
    if (isBackKey(e)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      handleBack()
      return
    }

    var vpVisible      = !document.getElementById('vpOverlay').classList.contains('hidden')
    var modalVisible   = !document.getElementById('modalOverlay').classList.contains('hidden')
    var profileVisible = !document.getElementById('profileScreen').classList.contains('hidden')

    if (vpVisible)      { handlePlayerKey(e); return }
    if (modalVisible)   { handleModalKey(e);  return }
    if (profileVisible) { handleProfileKey(e); return }
    handleBrowseKey(e)
  }, true)  // true = capture phase
}

function handleBack() {
  var vpOverlay     = document.getElementById('vpOverlay')
  var modalOverlay  = document.getElementById('modalOverlay')
  var profileScreen = document.getElementById('profileScreen')
  var pinScreen     = document.getElementById('pinScreen')

  if (!vpOverlay.classList.contains('hidden')) {
    if (typeof _epPanelOpen !== 'undefined' && _epPanelOpen) { closeEpPanel(); return }
    closePlayer()
    return
  }
  if (!modalOverlay.classList.contains('hidden')) { closeModal(); return }
  if (!profileScreen.classList.contains('hidden')) {
    if (!pinScreen.classList.contains('hidden')) { showProfilePicker(); return }
    return  // swallow at profile picker
  }
  // Browse: if in nav zone, drop back to content; otherwise swallow
  if (_browseZone === 'nav') { _browseZone = 'content'; updateNavFocus(); return }
  // Never exit the app
}

// ── BROWSE NAVIGATION ─────────────────────────────────────────────────────────

function handleBrowseKey(e) {
  if (_browseZone === 'nav') { handleNavKey(e); return }
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
        _browseZone = 'nav'
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
      _navFocusIdx = Math.max(0, _navFocusIdx - 1)
      updateNavFocus()
      break
    case 'ArrowRight':
      e.preventDefault()
      _navFocusIdx = Math.min(3, _navFocusIdx + 1)
      updateNavFocus()
      break
    case 'ArrowDown':
      e.preventDefault()
      _browseZone = 'content'
      updateNavFocus()
      focus(focusRow, focusCol)
      break
    case 'Enter':
      e.preventDefault()
      if (_navFocusIdx === 3) {
        showProfileScreen()
      } else {
        var filters = ['all', 'movie', 'tv']
        applyNavFilter(filters[_navFocusIdx])
        _browseZone = 'content'
        updateNavFocus()
      }
      break
  }
}

function updateNavFocus() {
  var inNav = (_browseZone === 'nav')
  document.querySelectorAll('.nav-link').forEach(function(el, i) {
    el.classList.toggle('tv-focused', inNav && i === _navFocusIdx)
  })
  var sw = document.getElementById('navSwitchBtn')
  if (sw) sw.classList.toggle('tv-focused', inNav && _navFocusIdx === 3)
}

function applyNavFilter(filter) {
  activeFilter = filter
  document.querySelectorAll('.nav-link').forEach(function(t) {
    t.classList.toggle('active', t.dataset.filter === filter)
  })
  filteredRows = filter === 'all'
    ? CONTENT_ROWS.slice()
    : CONTENT_ROWS.filter(function(r) { return r.type === filter || r.type === 'mixed' })
  loadRows()
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
  _profiles = [{ id: 'jack', name: 'Jack', avatar: 0, hasPin: false }]
}

function showProfilePicker() {
  if (_profiles.length === 1 && !_profiles[0].hasPin) {
    loginDirect(_profiles[0]); return
  }
  document.getElementById('profilePicker').classList.remove('hidden')
  document.getElementById('pinScreen').classList.add('hidden')
  _profileFocus = Math.max(0, Math.min(_profiles.length - 1, _profileFocus))
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
  if (p.hasPin) { showPinScreen(p) } else { loginDirect(p) }
}

function loginDirect(p) {
  enterBrowse()
  getJfToken().catch(function() {})
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

// ── PROFILE KEY HANDLING ──────────────────────────────────────────────────────

function handleProfileKey(e) {
  var pinVisible = !document.getElementById('pinScreen').classList.contains('hidden')
  if (pinVisible) { handlePinKey(e) } else { handlePickerKey(e) }
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

// ── ENTER BROWSE ──────────────────────────────────────────────────────────────

async function enterBrowse() {
  document.getElementById('profileScreen').classList.add('hidden')
  document.getElementById('browse').style.visibility = 'visible'
  _browseZone = 'content'
  filteredRows = CONTENT_ROWS.slice()
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

  // CW row (row index -1)
  cwRowData = cwRecent()
  if (cwRowData.length) {
    container.appendChild(buildCWRow(cwRowData))
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

    overlay.appendChild(titleEl2)

    if (e.type === 'tv') {
      var epEl = document.createElement('div')
      epEl.className = 'card-ep'
      epEl.textContent = 'S' + String(e.season || 1).padStart(2,'0') + 'E' + String(e.episode || 1).padStart(2,'0')
      overlay.appendChild(epEl)
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
  var rowEl = document.querySelector('.row[data-row="' + row + '"] .row-cards')
  if (!rowEl) return
  var cardW   = 228   // 220px card + 8px gap
  var visible = Math.floor(1920 * 0.92 / cardW) - 1
  var offset  = col > visible ? (col - visible) * cardW : 0
  rowEl.style.transform = 'translateX(-' + offset + 'px)'
}

function scrollContentToRow(row) {
  var rowsEl = document.getElementById('rows')
  var hasCW  = cwRowData.length > 0
  var domIdx = hasCW ? (row === -1 ? 0 : row + 1) : (row < 0 ? 0 : row)

  // Sum heights of rows above the target row
  var top = 0
  for (var i = 0; i < domIdx; i++) {
    var el = rowsEl.children[i]
    if (el) top += el.offsetHeight + 8
  }
  var shift = Math.max(0, top - 40)
  rowsEl.style.transform = 'translateY(-' + shift + 'px)'
}

// ── SELECT CARD ───────────────────────────────────────────────────────────────

function selectCard(row, col) {
  if (row === -1) {
    var e = cwRowData[col]
    if (!e) return
    openPlayer({ title: e.title, tmdbId: e.tmdbId, type: e.type, season: e.season, episode: e.episode, resumeFrom: e.position, posterPath: e.posterPath })
    return
  }
  var item = rowData[row] && rowData[row][col]
  if (!item) return
  var type = mtype(item, filteredRows[row] && filteredRows[row].type)
  openModal(item, type)
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

async function openModal(item, type) {
  _modalItem      = item
  _modalType      = type
  _modalFocusArea = 'play'
  _epFocusIdx     = 0

  var overlay = document.getElementById('modalOverlay')
  overlay.classList.remove('hidden')

  var bd = document.getElementById('modalBackdrop')
  bd.src = bdUrl(item.backdrop_path) || posterUrl(item.poster_path, 'w780')
  bd.alt = ttitle(item)

  document.getElementById('modalTitle').textContent    = ttitle(item)
  document.getElementById('modalOverview').textContent = item.overview || ''

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
    watchBtn.addEventListener('click', function() {
      // Play S01E01 directly
      closeModal()
      openPlayer({
        title:      ttitle(item) + ' \u00b7 S01E01',
        tmdbId:     item.id,
        type:       'tv',
        season:     1,
        episode:    1,
        posterPath: item.poster_path,
      })
    })
    actionsEl.appendChild(watchBtn)
  }

  var sideEl = document.getElementById('modalSide')
  sideEl.innerHTML = ''
  document.getElementById('episodesSection').classList.add('hidden')

  // Focus the play button
  updateModalFocus()

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

    var thumbWrap = document.createElement('div')
    thumbWrap.className = 'episode-thumb-wrap'
    var img = document.createElement('img')
    img.src = ep.still_path ? (IMG + '/w300' + ep.still_path) : ''
    img.alt = ep.name
    var playIcon = document.createElement('div')
    playIcon.className   = 'episode-play-icon'
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
        title:      ttitle(show) + ' \u00b7 S' + String(seasonNum).padStart(2,'0') + 'E' + String(ep.episode_number).padStart(2,'0'),
        tmdbId:     showId,
        type:       'tv',
        season:     seasonNum,
        episode:    ep.episode_number,
        posterPath: show.poster_path,
      })
    })
  })

  if (_modalFocusArea === 'episodes') updateModalFocus()
}

function updateModalFocus() {
  var pb = document.getElementById('modalPlayBtn')
  if (pb) pb.classList.toggle('tv-focused', _modalFocusArea === 'play')

  var cards = document.querySelectorAll('.episode-card')
  cards.forEach(function(c, i) {
    c.classList.toggle('focused', _modalFocusArea === 'episodes' && i === _epFocusIdx)
  })
  if (_modalFocusArea === 'episodes' && cards[_epFocusIdx]) {
    cards[_epFocusIdx].scrollIntoView({ block: 'nearest' })
  }
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden')
  _modalItem = null
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
      if (_modalFocusArea === 'play') {
        if (cards.length) { _modalFocusArea = 'episodes'; _epFocusIdx = 0; updateModalFocus() }
      } else {
        if (_epFocusIdx < cards.length - 1) { _epFocusIdx++; updateModalFocus() }
      }
      break
    }
    case 'ArrowUp': {
      e.preventDefault()
      if (_modalFocusArea === 'episodes') {
        if (_epFocusIdx > 0) {
          _epFocusIdx--; updateModalFocus()
        } else {
          _modalFocusArea = 'play'; updateModalFocus()
        }
      }
      break
    }
    case 'Enter': {
      e.preventDefault()
      if (_modalFocusArea === 'play') {
        var pb = document.getElementById('modalPlayBtn')
        if (pb) pb.click()
      } else {
        var eCards = document.querySelectorAll('.episode-card')
        if (eCards[_epFocusIdx]) eCards[_epFocusIdx].click()
      }
      break
    }
    case 'ArrowLeft': case 'ArrowRight': break
  }
}

// ── NAV TABS (click) ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.nav-link').forEach(function(tab) {
    tab.addEventListener('click', function() {
      applyNavFilter(tab.dataset.filter)
    })
  })
  var sw = document.getElementById('navSwitchBtn')
  if (sw) sw.addEventListener('click', showProfileScreen)
})

// ── BOOT ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', init)

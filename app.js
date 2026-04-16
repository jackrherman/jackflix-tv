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

const posterUrl = (p, sz) => { sz = sz || 'w342'; return p ? (IMG + '/' + sz + p) : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="330"><rect fill="%23333"/></svg>' }
const bdUrl     = (p, sz) => { sz = sz || 'w1280'; return p ? (IMG + '/' + sz + p) : '' }
const ttitle    = i => i.title || i.name || 'Unknown'
const year      = i => (i.release_date || i.first_air_date || '').slice(0, 4)
const stars     = i => i.vote_average ? '\u2605 ' + i.vote_average.toFixed(1) : ''
const mtype     = (i, rt) => rt !== 'mixed' ? rt : (i.media_type || 'movie')

// ── BROWSE STATE ──────────────────────────────────────────────────────────────

let focusRow     = 0
let focusCol     = 0
let rowData      = []
let activeFilter = 'all'
let filteredRows = []

// ── PROFILE STATE ─────────────────────────────────────────────────────────────

let _profiles        = []
let _profileFocus    = 0
let _manageMode      = false
let _pinEntry        = ''
let _pinProfile      = null
let _pinFocusIdx     = 0   // 0-11 within keypad
let _selectedAvatar  = 0
let _nameBuffer      = ''
let _kbFocusIdx      = 0

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  setupPlayer()
  setupNav()
  setupKeyboard()
  await showProfileScreen()
}

// ── PROFILE SCREEN ────────────────────────────────────────────────────────────

async function showProfileScreen() {
  document.getElementById('profileScreen').classList.remove('hidden')
  document.getElementById('browse').style.visibility = 'hidden'
  _manageMode   = false
  _profileFocus = 0
  await loadProfiles()
  showProfilePicker()
}

async function loadProfiles() {
  try {
    const r = await fetch(PROXY_BASE + '/api/profiles')
    _profiles = await r.json()
  } catch(_) { _profiles = [] }
}

function showProfilePicker() {
  document.getElementById('profilePicker').classList.remove('hidden')
  document.getElementById('pinScreen').classList.add('hidden')
  document.getElementById('createProfileScreen').classList.add('hidden')
  renderProfileCards()
}

function renderProfileCards() {
  const container = document.getElementById('profileCards')
  container.innerHTML = ''

  _profiles.forEach((p, i) => {
    const card = document.createElement('div')
    card.className = 'profile-card-tv' + (i === _profileFocus ? ' focused' : '') + (_manageMode ? ' delete-mode' : '')
    const color = AVATAR_COLORS[p.avatar || 0]
    card.innerHTML =
      '<div class="profile-avatar-tv" style="background:' + color + '">' + p.name[0].toUpperCase() + '</div>' +
      '<div class="profile-name-tv">' + p.name + '</div>' +
      (_manageMode ? '<div class="profile-delete-badge">\u00d7</div>' : '')
    card.dataset.i = i
    container.appendChild(card)
  })

  // + Add Profile
  const addIdx  = _profiles.length
  const addCard = document.createElement('div')
  addCard.className = 'profile-card-tv' + (addIdx === _profileFocus ? ' focused' : '')
  addCard.innerHTML =
    '<div class="profile-avatar-tv add-avatar">+</div>' +
    '<div class="profile-name-tv">Add Profile</div>'
  addCard.dataset.i = addIdx
  container.appendChild(addCard)

  // Manage button text
  const btn = document.getElementById('manageBtn')
  if (btn) btn.textContent = _manageMode ? 'Done' : 'Manage Profiles'
}

function profilePickerSelect() {
  const totalCards = _profiles.length + 1  // +1 for add card
  if (_profileFocus >= _profiles.length) {
    // "Add Profile" card selected
    showCreateProfileScreen()
    return
  }
  const p = _profiles[_profileFocus]
  if (_manageMode) {
    deleteProfile(p)
  } else if (p.hasPin) {
    showPinScreen(p)
  } else {
    loginDirect(p)
  }
}

async function deleteProfile(p) {
  try {
    await fetch(PROXY_BASE + '/api/profiles/' + p.id, { method: 'DELETE' })
    await loadProfiles()
    _profileFocus = Math.min(_profileFocus, _profiles.length)
    renderProfileCards()
  } catch(_) {}
}

async function loginDirect(p) {
  try {
    const r = await fetch(PROXY_BASE + '/api/auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ profileId: p.id }),
    })
    if (r.ok) {
      const { token } = await r.json()
      localStorage.setItem('jf_token', token)
      serverToken = token
      enterBrowse()
    }
  } catch(_) {}
}

// ── PIN SCREEN (TV) ───────────────────────────────────────────────────────────

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
  focusPinKey(_pinFocusIdx)
}

function buildPinKeypad() {
  const kp   = document.getElementById('pinKeypad')
  kp.innerHTML = ''
  const keys = ['1','2','3','4','5','6','7','8','9','del','0','ok']
  keys.forEach((k, idx) => {
    const btn = document.createElement('button')
    btn.className   = 'pin-key-tv'
    btn.dataset.k   = k
    btn.dataset.idx = idx
    btn.textContent = k === 'del' ? '\u232b' : k === 'ok' ? '\u2713' : k
    btn.addEventListener('click', () => onPinKeyPress(k))
    kp.appendChild(btn)
  })
}

function focusPinKey(idx) {
  document.querySelectorAll('.pin-key-tv').forEach((b, i) => {
    b.classList.toggle('active', i === idx)
    if (i === idx) b.focus()
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
  document.querySelectorAll('.pin-dot-tv').forEach((d, i) =>
    d.classList.toggle('filled', i < _pinEntry.length))
}

async function submitPin() {
  if (!_pinProfile) return
  try {
    const r = await fetch(PROXY_BASE + '/api/auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ profileId: _pinProfile.id, pin: _pinEntry }),
    })
    if (r.ok) {
      const { token } = await r.json()
      localStorage.setItem('jf_token', token)
      serverToken = token
      enterBrowse()
    } else {
      _pinEntry = ''
      updatePinDots()
      document.getElementById('pinError').classList.remove('hidden')
      _pinFocusIdx = 0
      focusPinKey(0)
    }
  } catch(_) {
    _pinEntry = ''
    updatePinDots()
    _pinFocusIdx = 0
    focusPinKey(0)
  }
}

// ── CREATE PROFILE SCREEN (TV) ────────────────────────────────────────────────

function showCreateProfileScreen() {
  _nameBuffer      = ''
  _selectedAvatar  = 0
  _kbFocusIdx      = 0
  document.getElementById('profilePicker').classList.add('hidden')
  document.getElementById('createProfileScreen').classList.remove('hidden')
  document.getElementById('nameDisplay').textContent = '_'

  buildAvatarPickerTv()
  buildNameKeyboard()
  focusKbKey(0)
}

function buildAvatarPickerTv() {
  const ap = document.getElementById('avatarPickerTv')
  ap.innerHTML = ''
  AVATAR_COLORS.forEach((c, i) => {
    const sw = document.createElement('button')
    sw.className = 'avatar-swatch-tv' + (i === 0 ? ' selected' : '')
    sw.style.background = c
    sw.dataset.i = i
    sw.addEventListener('click', () => {
      _selectedAvatar = i
      document.querySelectorAll('.avatar-swatch-tv').forEach((s, j) =>
        s.classList.toggle('selected', j === i))
    })
    ap.appendChild(sw)
  })
}

function buildNameKeyboard() {
  const kb    = document.getElementById('nameKeyboard')
  kb.innerHTML = ''
  const rows  = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', ' <DEL>']
  let kbKeys  = []
  rows.forEach(row => {
    row.split('').forEach(ch => {
      if (ch === '<') return
      const k   = ch === 'D' && row.includes('DEL') ? 'DEL' : ch
      // Filter out the '<DEL>' pseudo-token — we handle "DEL" directly
      kbKeys.push(k)
    })
  })
  // Rebuild cleanly
  kbKeys = []
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(c => kbKeys.push(c))
  kbKeys.push('SPC')
  kbKeys.push('DEL')
  kbKeys.push('DONE')

  kbKeys.forEach((k, idx) => {
    const btn = document.createElement('button')
    btn.className   = 'kb-key' + (k.length > 1 ? ' kb-key-wide' : '')
    btn.textContent = k === 'SPC' ? 'Space' : k === 'DEL' ? '\u232b' : k === 'DONE' ? 'Done' : k
    btn.dataset.idx = idx
    btn.addEventListener('click', () => onKbKey(k))
    kb.appendChild(btn)
  })
}

function focusKbKey(idx) {
  _kbFocusIdx = idx
  document.querySelectorAll('.kb-key').forEach((b, i) => {
    if (i === idx) b.focus()
  })
}

function onKbKey(k) {
  if (k === 'DEL') {
    _nameBuffer = _nameBuffer.slice(0, -1)
  } else if (k === 'SPC') {
    if (_nameBuffer.length < 20) _nameBuffer += ' '
  } else if (k === 'DONE') {
    createProfile()
    return
  } else {
    if (_nameBuffer.length < 20) _nameBuffer += k
  }
  document.getElementById('nameDisplay').textContent = _nameBuffer || '_'
}

async function createProfile() {
  const name = _nameBuffer.trim()
  if (!name) { focusKbKey(0); return }
  try {
    const r = await fetch(PROXY_BASE + '/api/profiles', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, avatar: _selectedAvatar }),
    })
    if (r.ok) {
      await loadProfiles()
      showProfilePicker()
    }
  } catch(_) {}
}

// ── ENTER BROWSE ──────────────────────────────────────────────────────────────

async function enterBrowse() {
  document.getElementById('profileScreen').classList.add('hidden')
  document.getElementById('browse').style.visibility = 'visible'
  filteredRows = ROWS
  await loadCWFromServer()
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
    const items = ((results[ri] && results[ri].results) || []).slice(0, 20)
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

  // Continue Watching row first
  const cwEntries = cwRecent()
  if (cwEntries.length) {
    const cwRow = buildCWRow(cwEntries)
    container.appendChild(cwRow)
  }

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

// ── CONTINUE WATCHING ROW ─────────────────────────────────────────────────────

// CW row uses a separate virtual "row index" of -1 so normal row navigation
// still works. We prepend it to the DOM but keep rowData/filteredRows unchanged.
let cwRowData = []

function buildCWRow(entries) {
  cwRowData = entries

  const rowEl = document.createElement('div')
  rowEl.className = 'row'
  rowEl.dataset.row = -1

  const title = document.createElement('div')
  title.className = 'row-title'
  title.textContent = 'Continue Watching'

  const cards = document.createElement('div')
  cards.className = 'row-cards'

  entries.forEach((e, ci) => {
    const card = document.createElement('div')
    card.className = 'card'
    card.tabIndex = -1
    card.dataset.row = -1
    card.dataset.col = ci

    const img = document.createElement('img')
    img.src = posterUrl(e.posterPath)
    img.alt = e.title

    const label = document.createElement('div')
    label.className = 'card-label'
    label.textContent = e.title

    const bar = document.createElement('div')
    bar.className = 'cw-bar'
    const fill = document.createElement('div')
    fill.className = 'cw-bar-fill'
    fill.style.width = Math.round(e.pct * 100) + '%'
    bar.appendChild(fill)

    if (e.type === 'tv') {
      const epLbl = document.createElement('div')
      epLbl.className = 'card-ep-label'
      epLbl.textContent = 'S' + e.season + 'E' + e.episode
      card.appendChild(epLbl)
    }

    card.appendChild(img)
    card.appendChild(label)
    card.appendChild(bar)
    cards.appendChild(card)
  })

  rowEl.appendChild(title)
  rowEl.appendChild(cards)
  return rowEl
}

// ── HERO ──────────────────────────────────────────────────────────────────────

function updateHero() {
  const items = rowData[0] || []
  const item  = items[0]
  if (!item) return
  setHero(item)
}

function updateHeroFromFocus() {
  let item
  if (focusRow === -1) {
    item = cwRowData[focusCol]
  } else {
    item = rowData[focusRow] && rowData[focusRow][focusCol]
  }
  if (!item) return
  setHero(item)
}

function setHero(item) {
  document.getElementById('heroBg').style.backgroundImage = 'url(\'' + bdUrl(item.backdrop_path) + '\')'
  document.getElementById('heroTitle').textContent    = ttitle(item)
  document.getElementById('heroMeta').textContent     = [year(item), stars(item)].filter(Boolean).join(' \u00b7 ')
  document.getElementById('heroOverview').textContent = item.overview || ''
}

// ── FOCUS MANAGEMENT ─────────────────────────────────────────────────────────

function focus(row, col) {
  const hasCW    = cwRowData.length > 0
  const minRow   = hasCW ? -1 : 0
  row = Math.max(minRow, Math.min(filteredRows.length - 1, row))

  let items
  if (row === -1) {
    items = cwRowData
  } else {
    items = rowData[row] || []
  }
  col = Math.max(0, Math.min(items.length - 1, col || 0))

  focusRow = row
  focusCol = col

  document.querySelectorAll('.card.focused').forEach(c => c.classList.remove('focused'))

  const card = getCard(row, col)
  if (card) {
    card.classList.add('focused')
    scrollRowToCard(row, col)
    scrollBrowseToRow(row)
    updateHeroFromFocus()
  }
}

function getCard(row, col) {
  return document.querySelector('.card[data-row="' + row + '"][data-col="' + col + '"]')
}

function scrollRowToCard(row, col) {
  const selector = row === -1
    ? '.row[data-row="-1"] .row-cards'
    : '.row[data-row="' + row + '"] .row-cards'
  const rowEl = document.querySelector(selector)
  if (!rowEl) return
  const cardW   = 220 + 16
  const visible = Math.floor(1920 / cardW) - 1
  const offset  = col > visible ? (col - visible) * cardW : 0
  rowEl.style.transform = 'translateX(-' + offset + 'px)'
}

function scrollBrowseToRow(row) {
  const rowsEl = document.getElementById('rows')
  const hasCW  = cwRowData.length > 0

  // Convert logical row index to DOM index (CW row = 0 if present)
  const domIdx  = hasCW ? row + 1 : row  // CW is row -1 → dom 0; row 0 → dom 1...
  const rowEl   = rowsEl.children[hasCW ? (row === -1 ? 0 : row + 1) : row]
  if (!rowEl) return
  const rowH    = rowEl.offsetHeight + 48
  const offset  = (hasCW ? (row === -1 ? 0 : row + 1) : row) * rowH
  const maxShow = 1080 - 540
  const shift   = Math.max(0, offset - maxShow / 2)
  rowsEl.style.transform = 'translateY(-' + shift + 'px)'
}

// ── KEYBOARD / D-PAD ─────────────────────────────────────────────────────────

function setupKeyboard() {
  document.addEventListener('keydown', function(e) {
    if (!document.getElementById('player').classList.contains('hidden')) {
      handlePlayerKey(e); return
    }
    if (!document.getElementById('detail').classList.contains('hidden')) {
      handleDetailKey(e); return
    }
    if (!document.getElementById('profileScreen').classList.contains('hidden')) {
      handleProfileKey(e); return
    }
    handleBrowseKey(e)
  })

  document.addEventListener('keydown', function(e) {
    if (e.keyCode === 461) {
      if (!document.getElementById('detail').classList.contains('hidden')) {
        closeDetail()
      } else if (!document.getElementById('profileScreen').classList.contains('hidden')) {
        handleProfileBack()
      }
    }
  })
}

function handleProfileKey(e) {
  const pinVisible    = !document.getElementById('pinScreen').classList.contains('hidden')
  const createVisible = !document.getElementById('createProfileScreen').classList.contains('hidden')
  const pickerVisible = !document.getElementById('profilePicker').classList.contains('hidden')

  if (pinVisible) {
    handlePinKey(e)
  } else if (createVisible) {
    handleCreateKey(e)
  } else if (pickerVisible) {
    handlePickerKey(e)
  }
}

function handlePickerKey(e) {
  const totalCards = _profiles.length + 1  // includes "Add Profile"
  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault()
      _profileFocus = Math.min(totalCards - 1, _profileFocus + 1)
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
    case 'ArrowDown': {
      // Move focus to Manage button
      e.preventDefault()
      const btn = document.getElementById('manageBtn')
      if (btn) btn.focus()
      break
    }
  }
}

function handlePinKey(e) {
  const keys = document.querySelectorAll('.pin-key-tv')
  const cols  = 3
  const rows  = Math.ceil(keys.length / cols)

  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault()
      _pinFocusIdx = Math.min(keys.length - 1, _pinFocusIdx + 1)
      focusPinKey(_pinFocusIdx)
      break
    case 'ArrowLeft':
      e.preventDefault()
      _pinFocusIdx = Math.max(0, _pinFocusIdx - 1)
      focusPinKey(_pinFocusIdx)
      break
    case 'ArrowDown':
      e.preventDefault()
      _pinFocusIdx = Math.min(keys.length - 1, _pinFocusIdx + cols)
      focusPinKey(_pinFocusIdx)
      break
    case 'ArrowUp':
      e.preventDefault()
      if (_pinFocusIdx >= cols) { _pinFocusIdx -= cols; focusPinKey(_pinFocusIdx) }
      break
    case 'Enter':
      e.preventDefault()
      if (keys[_pinFocusIdx]) onPinKeyPress(keys[_pinFocusIdx].dataset.k)
      break
    case 'Escape': case 'GoBack': case 'BrowserBack':
      e.preventDefault()
      _pinEntry = ''; showProfilePicker(); break
  }
}

function handleCreateKey(e) {
  const keys = document.querySelectorAll('.kb-key')
  const cols  = 13

  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault()
      _kbFocusIdx = Math.min(keys.length - 1, _kbFocusIdx + 1)
      focusKbKey(_kbFocusIdx)
      break
    case 'ArrowLeft':
      e.preventDefault()
      _kbFocusIdx = Math.max(0, _kbFocusIdx - 1)
      focusKbKey(_kbFocusIdx)
      break
    case 'ArrowDown':
      e.preventDefault()
      _kbFocusIdx = Math.min(keys.length - 1, _kbFocusIdx + cols)
      focusKbKey(_kbFocusIdx)
      break
    case 'ArrowUp':
      e.preventDefault()
      if (_kbFocusIdx >= cols) { _kbFocusIdx -= cols; focusKbKey(_kbFocusIdx) }
      break
    case 'Enter':
      e.preventDefault()
      if (keys[_kbFocusIdx]) onKbKey(keys[_kbFocusIdx].textContent === 'Space' ? 'SPC' : keys[_kbFocusIdx].textContent === 'Done' ? 'DONE' : keys[_kbFocusIdx].textContent)
      break
    case 'Escape': case 'GoBack': case 'BrowserBack':
      e.preventDefault()
      showProfilePicker(); break
  }
}

function handleProfileBack() {
  const pinVisible    = !document.getElementById('pinScreen').classList.contains('hidden')
  const createVisible = !document.getElementById('createProfileScreen').classList.contains('hidden')
  if (pinVisible || createVisible) showProfilePicker()
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
      if (typeof window.close === 'function') window.close()
      break
  }
}

// ── SELECT / DETAIL ───────────────────────────────────────────────────────────

function selectCard(row, col) {
  if (row === -1) {
    // CW card
    const e = cwRowData[col]
    if (!e) return
    openPlayer({
      title:   e.title,
      tmdbId:  e.tmdbId,
      type:    e.type,
      season:  e.season,
      episode: e.episode,
      resumeFrom: e.position,
    })
    return
  }
  const item = rowData[row] && rowData[row][col]
  if (!item) return
  const type = mtype(item, filteredRows[row] && filteredRows[row].type)
  showDetail(item, type)
}

function showDetail(item, type) {
  const detail = document.getElementById('detail')
  detail.classList.remove('hidden')

  document.getElementById('detailBg').style.backgroundImage = 'url(\'' + bdUrl(item.backdrop_path) + '\')'
  document.getElementById('detailTitle').textContent    = ttitle(item)
  document.getElementById('detailMeta').textContent     = [year(item), stars(item), type === 'tv' ? 'TV Show' : 'Movie'].filter(Boolean).join(' \u00b7 ')
  document.getElementById('detailOverview').textContent = item.overview || ''

  const actions = document.getElementById('detailActions')
  actions.innerHTML = ''

  if (type === 'movie') {
    const playBtn = document.createElement('button')
    playBtn.className = 'detail-btn detail-btn-play'
    playBtn.textContent = '\u25b6 Play'
    playBtn.addEventListener('click', function() {
      closeDetail()
      openPlayer({ title: ttitle(item), tmdbId: item.id, type: 'movie' })
    })
    actions.appendChild(playBtn)
    setTimeout(function() { playBtn.focus() }, 50)
  } else {
    const epBtn = document.createElement('button')
    epBtn.className = 'detail-btn detail-btn-tv'
    epBtn.textContent = '\u25b6 Watch'
    epBtn.addEventListener('click', function() { loadEpPicker(item) })
    actions.appendChild(epBtn)
    document.getElementById('epPicker').classList.add('hidden')
    setTimeout(function() { epBtn.focus() }, 50)
  }

  detail._item = item
  detail._type = type
}

async function loadEpPicker(item) {
  const picker = document.getElementById('epPicker')
  picker.classList.remove('hidden')

  const data = await tmdb('/tv/' + item.id).catch(function() { return null })
  if (!data) return

  const seasons = (data.seasons || []).filter(function(s) { return s.season_number > 0 })

  const seasonRow = document.getElementById('epSeasonRow')
  seasonRow.innerHTML = ''
  seasons.forEach(function(s, i) {
    const btn = document.createElement('button')
    btn.className = 'ep-season-btn' + (i === 0 ? ' active' : '')
    btn.textContent = 'Season ' + s.season_number
    btn.addEventListener('click', function() {
      document.querySelectorAll('.ep-season-btn').forEach(function(b) { b.classList.remove('active') })
      btn.classList.add('active')
      loadEpisodes(item.id, s.season_number)
    })
    seasonRow.appendChild(btn)
  })

  if (seasons.length) {
    loadEpisodes(item.id, seasons[0].season_number)
    setTimeout(function() { if (seasonRow.firstChild) seasonRow.firstChild.focus() }, 50)
  }
}

async function loadEpisodes(showId, seasonNum) {
  const data = await tmdb('/tv/' + showId + '/season/' + seasonNum).catch(function() { return null })
  const list = document.getElementById('epList')
  list.innerHTML = ''
  if (!data) return

  const show = document.getElementById('detail')._item
  ;(data.episodes || []).forEach(function(ep) {
    const el = document.createElement('div')
    el.className = 'ep-item'
    el.tabIndex = 0

    const img = document.createElement('img')
    img.src = ep.still_path ? (IMG + '/w300' + ep.still_path) : ''
    img.alt = ep.name

    const info = document.createElement('div')
    info.className = 'ep-info'
    const num  = document.createElement('div'); num.className  = 'ep-num';  num.textContent  = 'E' + ep.episode_number
    const name = document.createElement('div'); name.className = 'ep-name'; name.textContent = ep.name

    info.appendChild(num); info.appendChild(name)
    el.appendChild(img); el.appendChild(info)
    list.appendChild(el)

    el.addEventListener('click', function() {
      closeDetail()
      openPlayer({
        title:   ttitle(show) + '  \u00b7  S' + String(seasonNum).padStart(2,'0') + 'E' + String(ep.episode_number).padStart(2,'0'),
        tmdbId:  showId,
        type:    'tv',
        season:  seasonNum,
        episode: ep.episode_number,
      })
    })
    el.addEventListener('keydown', function(e) {
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
      break
  }
}

// ── NAV TABS ──────────────────────────────────────────────────────────────────

function setupNav() {
  document.querySelectorAll('.nav-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      activeFilter = tab.dataset.filter
      document.querySelectorAll('.nav-tab').forEach(function(t) { t.classList.remove('active') })
      tab.classList.add('active')
      filteredRows = activeFilter === 'all'
        ? ROWS
        : ROWS.filter(function(r) { return r.type === activeFilter || r.type === 'mixed' })
      loadRows()
    })
  })
}

// ── MANAGE BUTTON ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  const btn = document.getElementById('manageBtn')
  if (btn) {
    btn.addEventListener('click', function() {
      _manageMode = !_manageMode
      renderProfileCards()
    })
    btn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') btn.click()
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        // Return focus to profile cards
        document.querySelectorAll('.profile-card-tv')[_profileFocus] &&
          document.querySelectorAll('.profile-card-tv')[_profileFocus].focus()
      }
    })
  }
})

// ── BOOT ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', init)

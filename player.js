'use strict'

// ── CONFIG ────────────────────────────────────────────────────────────────────

const PROXY_BASE = 'https://jackflix-proxy.jackrherman.workers.dev'
const JF_SERVER  = 'https://jackflix.onrender.com'
const JF_PIN     = '5396'
const TMDB_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4MjVlMzYzYTM3MDRhZDk5MTZlOTE4NzI3OWJjNjRkYyIsIm5iZiI6MTc3NjI4OTMwMC44MzgsInN1YiI6IjY5ZTAwNjE0OWMzOWYzNTRmODAxMmM0MCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.NSmPuuHTY8KGU4GTN4hz8_PVe9bxnXxmlfi5Ce5Co8A'
const IMG        = 'https://image.tmdb.org/t/p'

// ── SERVER TOKEN ──────────────────────────────────────────────────────────────

var serverToken = localStorage.getItem('jf_tv_token') || null

// ── TMDB HELPER ───────────────────────────────────────────────────────────────

function tmdb(ep, p) {
  p = p || {}
  var url = new URL('https://api.themoviedb.org/3' + ep)
  Object.keys(p).forEach(function(k) { url.searchParams.set(k, p[k]) })
  return fetch(url.toString(), { headers: { Authorization: 'Bearer ' + TMDB_TOKEN } }).then(function(r) { return r.json() })
}

// ── CONTINUE WATCHING ─────────────────────────────────────────────────────────

var CW_KEY = 'cineb_cw'

function cwKey(p) {
  return p.type === 'movie' ? 'm_' + p.tmdbId : 't_' + p.tmdbId + '_' + p.season + '_' + p.episode
}

function cwAll() {
  try { return JSON.parse(localStorage.getItem(CW_KEY) || '{}') } catch(_) { return {} }
}

function cwGet(p) { return cwAll()[cwKey(p)] || null }

function cwRecent() {
  return Object.values(cwAll())
    .filter(function(e) { return e.pct > 0.02 && e.pct < 0.95 })
    .sort(function(a, b) { return b.ts - a.ts })
    .slice(0, 20)
}

function cwSave() {
  var v = document.getElementById('vpVideo')
  if (!currentItem || !v.duration || v.duration < 60) return
  var pct = v.currentTime / v.duration
  if (pct < 0.02 || pct > 0.95) return
  var store = cwAll()
  store[cwKey(currentItem)] = {
    tmdbId:     currentItem.tmdbId,
    type:       currentItem.type,
    title:      currentItem.title,
    posterPath: currentItem.posterPath || null,
    season:     currentItem.season,
    episode:    currentItem.episode,
    position:   v.currentTime,
    duration:   v.duration,
    pct:        pct,
    ts:         Date.now(),
  }
  var entries = Object.entries(store).sort(function(a,b) { return b[1].ts - a[1].ts })
  localStorage.setItem(CW_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, 50))))
  syncWithServer()
}

async function getJfToken() {
  if (serverToken) return serverToken
  try {
    var r = await fetch(JF_SERVER + '/api/auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ profileId: 'jack', pin: JF_PIN }),
    })
    if (r.ok) {
      var data = await r.json()
      serverToken = data.token
      localStorage.setItem('jf_tv_token', serverToken)
      return serverToken
    }
  } catch(_) {}
  return null
}

async function syncWithServer() {
  var tok = await getJfToken()
  if (!tok) return
  fetch(JF_SERVER + '/api/cw', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
    body:    JSON.stringify(cwAll()),
  }).then(function(r) {
    if (r.status === 401) { serverToken = null; localStorage.removeItem('jf_tv_token') }
  }).catch(function() {})
}

async function loadCWFromServer() {
  var tok = await getJfToken()
  if (!tok) return
  try {
    var r = await fetch(JF_SERVER + '/api/cw', {
      headers: { 'Authorization': 'Bearer ' + tok },
    })
    if (!r.ok) return
    var serverCW = await r.json()
    var local    = cwAll()
    var merged   = Object.assign({}, local)
    Object.keys(serverCW).forEach(function(k) {
      if (!merged[k] || (serverCW[k].ts || 0) > (merged[k].ts || 0)) merged[k] = serverCW[k]
    })
    localStorage.setItem(CW_KEY, JSON.stringify(merged))
  } catch(_) {}
}

// ── PLAYER STATE ──────────────────────────────────────────────────────────────

var currentItem   = null
var extractionId  = 0
var hlsInstance   = null
var controlsTimer = null
var serverIndex   = 0
var _cwTimer      = null
var _extractCleanup = null
var _epPanelOpen  = false

// ── OPEN / CLOSE PLAYER ───────────────────────────────────────────────────────

function openPlayer(item) {
  currentItem = item
  serverIndex = 0

  if (item.resumeFrom === undefined || item.resumeFrom === null) {
    var saved = cwGet(item)
    if (saved && saved.pct > 0.02 && saved.pct < 0.95) {
      currentItem.resumeFrom = saved.position
    }
  }

  document.getElementById('vpOverlay').classList.remove('hidden')
  document.getElementById('browse').style.visibility = 'hidden'
  document.getElementById('modalOverlay').classList.add('hidden')
  document.getElementById('vpTitle').textContent = item.title || ''
  document.getElementById('vpNextBtn').classList.toggle('hidden', item.type !== 'tv')
  document.getElementById('vpPrevBtn').classList.toggle('hidden', item.type !== 'tv')
  document.getElementById('vpEpListBtn').classList.toggle('hidden', item.type !== 'tv')

  showVpLoading('Finding stream\u2026')
  tryServer(0)
}

function closePlayer() {
  cwSave()
  if (_cwTimer) { clearInterval(_cwTimer); _cwTimer = null }
  stopExtraction()
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
  var v = document.getElementById('vpVideo')
  v.pause(); v.src = ''
  document.getElementById('vpOverlay').classList.add('hidden')
  document.getElementById('browse').style.visibility = 'visible'
  hideVpControls()
  closeEpPanel()
  currentItem = null
}

// ── STREAM EXTRACTION ─────────────────────────────────────────────────────────

function stopExtraction() {
  if (_extractCleanup) { _extractCleanup(); _extractCleanup = null }
  var old = document.getElementById('jf-extract-iframe')
  if (old) old.remove()
}

async function tryServer(idx) {
  serverIndex = idx
  stopExtraction()
  showVpLoading('Finding stream\u2026 (source ' + (idx + 1) + ')')
  syncServerBtns()

  extractionId++
  var myId = extractionId

  var flixUrl
  try {
    var type    = currentItem.type
    var tmdbId  = currentItem.tmdbId
    var season  = currentItem.season  || 1
    var episode = currentItem.episode || 1

    var qs  = new URLSearchParams({ tmdbId: tmdbId, type: type, season: season, episode: episode })
    var res = await fetch(PROXY_BASE + '/api/resolve?' + qs)
    if (!res.ok) throw new Error('resolve ' + res.status)
    var data = await res.json()

    var raw = idx === 0 ? data.video_url : (data.upn_url || data.video_url)
    if (!raw) throw new Error('no url')

    var hashIdx = raw.indexOf('#')
    var base    = hashIdx !== -1 ? raw.slice(0, hashIdx) : raw
    var hash    = hashIdx !== -1 ? raw.slice(hashIdx)    : ''
    flixUrl = PROXY_BASE + '/api/embed-proxy?url=' + encodeURIComponent(base) + '&ref=' + encodeURIComponent(base) + hash
  } catch(e) {
    if (extractionId !== myId) return
    if (idx < 1) { tryServer(idx + 1); return }
    showVpLoading('No stream found. Press Back.')
    return
  }

  var iframe    = document.createElement('iframe')
  iframe.id     = 'jf-extract-iframe'
  iframe.src    = flixUrl
  iframe.style.cssText = 'position:fixed;width:800px;height:450px;top:-9999px;left:-9999px;opacity:0;pointer-events:none;'
  document.body.appendChild(iframe)

  var timeout = setTimeout(function() {
    if (extractionId !== myId) return
    stopExtraction()
    window.removeEventListener('message', handler)
    if (serverIndex < 1) { tryServer(serverIndex + 1) } else { showVpLoading('No stream found. Press Back.') }
  }, 45000)

  function handler(e) {
    if (extractionId !== myId) return
    if (!e.data || e.data.type !== 'jf-stream') return
    var url = e.data.url
    if (!url || !url.includes('.m3u8')) return
    clearTimeout(timeout)
    stopExtraction()
    window.removeEventListener('message', handler)
    if (!currentItem) return
    startPlayback(url)
  }

  window.addEventListener('message', handler)
  _extractCleanup = function() {
    clearTimeout(timeout)
    window.removeEventListener('message', handler)
  }
}

// ── PLAYBACK ──────────────────────────────────────────────────────────────────

function startPlayback(streamUrl) {
  var v = document.getElementById('vpVideo')
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
  if (_cwTimer)    { clearInterval(_cwTimer); _cwTimer = null }
  hideVpLoading()
  showVpControls()

  function onReady() {
    if (currentItem && currentItem.resumeFrom > 0) v.currentTime = currentItem.resumeFrom
    v.play()
    _cwTimer = setInterval(cwSave, 15000)
  }

  if (Hls.isSupported()) {
    hlsInstance = new Hls({ enableWorker: true })
    hlsInstance.loadSource(streamUrl)
    hlsInstance.attachMedia(v)
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, function() {
      buildQualityMenu()
      onReady()
    })
    hlsInstance.on(Hls.Events.ERROR, function(_, d) {
      if (d.fatal) showVpLoading('Playback error. Try another source.')
    })
    v.addEventListener('waiting', function() { document.getElementById('vpBufRing').classList.remove('hidden') })
    v.addEventListener('playing', function() { document.getElementById('vpBufRing').classList.add('hidden') })
  } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
    v.src = streamUrl
    v.addEventListener('loadedmetadata', onReady, { once: true })
  } else {
    showVpLoading('HLS not supported.')
    return
  }

  v.addEventListener('timeupdate', updateSeekBar)
}

function updateSeekBar() {
  var v = document.getElementById('vpVideo')
  if (!v.duration) return
  var pct = v.currentTime / v.duration * 100
  document.getElementById('vpSeekFill').style.width = pct + '%'
  document.getElementById('vpSeekDot').style.left   = pct + '%'
  document.getElementById('vpTime').textContent = fmt(v.currentTime) + ' / ' + fmt(v.duration)

  var bufPct = 0
  if (v.buffered.length) {
    bufPct = (v.buffered.end(v.buffered.length - 1) / v.duration) * 100
  }
  document.getElementById('vpSeekBuf').style.width = bufPct + '%'
}

function fmt(s) {
  var h  = Math.floor(s / 3600)
  var m  = Math.floor((s % 3600) / 60)
  var ss = Math.floor(s % 60)
  return h > 0
    ? h + ':' + String(m).padStart(2,'0') + ':' + String(ss).padStart(2,'0')
    : m + ':' + String(ss).padStart(2,'0')
}

// ── QUALITY MENU ──────────────────────────────────────────────────────────────

function buildQualityMenu() {
  if (!hlsInstance) return
  var menu = document.getElementById('vpQualityMenu')
  menu.innerHTML = ''

  var autoBtn = document.createElement('button')
  autoBtn.className   = 'vp-quality-opt' + (hlsInstance.currentLevel === -1 ? ' active' : '')
  autoBtn.textContent = 'Auto'
  autoBtn.addEventListener('click', function() {
    hlsInstance.currentLevel = -1
    document.getElementById('vpQualityBtn').textContent = 'AUTO'
    document.querySelectorAll('.vp-quality-opt').forEach(function(b) { b.classList.remove('active') })
    autoBtn.classList.add('active')
    menu.classList.add('hidden')
  })
  menu.appendChild(autoBtn)

  hlsInstance.levels.forEach(function(l, i) {
    var label = l.height ? l.height + 'p' : 'Level ' + i
    var btn = document.createElement('button')
    btn.className   = 'vp-quality-opt'
    btn.textContent = label
    btn.addEventListener('click', function() {
      hlsInstance.currentLevel = i
      document.getElementById('vpQualityBtn').textContent = label
      document.querySelectorAll('.vp-quality-opt').forEach(function(b) { b.classList.remove('active') })
      btn.classList.add('active')
      menu.classList.add('hidden')
    })
    menu.appendChild(btn)
  })
}

// ── CONTROLS UI ───────────────────────────────────────────────────────────────

function showVpLoading(msg) {
  document.getElementById('vpLoading').classList.remove('hidden')
  document.getElementById('vpLoadingMsg').textContent = msg || ''
  hideVpControls()
}

function hideVpLoading() { document.getElementById('vpLoading').classList.add('hidden') }

function showVpControls() {
  document.getElementById('vpControls').classList.remove('vp-hidden')
  resetControlsTimer()
}

function hideVpControls() {
  document.getElementById('vpControls').classList.add('vp-hidden')
  if (controlsTimer) { clearTimeout(controlsTimer); controlsTimer = null }
}

function resetControlsTimer() {
  if (controlsTimer) clearTimeout(controlsTimer)
  controlsTimer = setTimeout(hideVpControls, 4000)
}

function syncServerBtns() {
  document.querySelectorAll('.vp-srv-btn').forEach(function(b, i) {
    b.classList.toggle('active', i === serverIndex)
  })
}

// ── PLAY PAUSE ICON ───────────────────────────────────────────────────────────

function syncPlayIcon() {
  var v = document.getElementById('vpVideo')
  document.getElementById('vpPlayIcon').style.display  = v.paused ? '' : 'none'
  document.getElementById('vpPauseIcon').style.display = v.paused ? 'none' : ''
}

// ── EPISODE PANEL ─────────────────────────────────────────────────────────────

function openEpPanel() {
  _epPanelOpen = true
  document.getElementById('vpEpPanel').classList.remove('hidden')
  document.getElementById('vpEpListBtn').classList.add('open')
  loadEpPanel(currentItem.season || 1)
}

function closeEpPanel() {
  _epPanelOpen = false
  document.getElementById('vpEpPanel').classList.add('hidden')
  document.getElementById('vpEpListBtn').classList.remove('open')
}

async function loadEpPanel(seasonNum) {
  var sel = document.getElementById('vpEpSeasonSel')
  var list = document.getElementById('vpEpPanelList')

  if (!sel.options.length) {
    var showData = await tmdb('/tv/' + currentItem.tmdbId).catch(function() { return null })
    if (!showData) return
    var seasons = (showData.seasons || []).filter(function(s) { return s.season_number > 0 })
    sel.innerHTML = ''
    seasons.forEach(function(s) {
      var opt = document.createElement('option')
      opt.value = s.season_number
      opt.textContent = 'Season ' + s.season_number
      if (s.season_number === (currentItem.season || 1)) opt.selected = true
      sel.appendChild(opt)
    })
    sel.addEventListener('change', function() { loadEpPanel(+sel.value) })
  }
  sel.value = seasonNum

  var data = await tmdb('/tv/' + currentItem.tmdbId + '/season/' + seasonNum).catch(function() { return null })
  list.innerHTML = ''
  if (!data) return

  var cw = cwAll()
  ;(data.episodes || []).forEach(function(ep) {
    var key    = 't_' + currentItem.tmdbId + '_' + seasonNum + '_' + ep.episode_number
    var cwData = cw[key]
    var isCur  = seasonNum === (currentItem.season || 1) && ep.episode_number === (currentItem.episode || 1)

    var item = document.createElement('div')
    item.className = 'vp-ep-item' + (isCur ? ' current' : '')

    var thumb = document.createElement('div'); thumb.className = 'vp-ep-thumb'
    var img   = document.createElement('img')
    img.src = ep.still_path ? (IMG + '/w300' + ep.still_path) : ''
    img.alt = ep.name
    var playIco = document.createElement('div'); playIco.className = 'vp-ep-thumb-play'; playIco.textContent = '▶'

    var progWrap = document.createElement('div'); progWrap.className = 'vp-ep-thumb-prog'
    var progFill = document.createElement('div'); progFill.className = 'vp-ep-thumb-prog-fill'
    progFill.style.width = cwData ? Math.round(cwData.pct * 100) + '%' : '0%'
    progWrap.appendChild(progFill)

    thumb.appendChild(img); thumb.appendChild(playIco); thumb.appendChild(progWrap)

    var info   = document.createElement('div'); info.className = 'vp-ep-info'
    var num    = document.createElement('div'); num.className = 'vp-ep-num'; num.textContent = 'E' + ep.episode_number
    var title  = document.createElement('div'); title.className = 'vp-ep-title'; title.textContent = ep.name
    var rt     = document.createElement('div'); rt.className = 'vp-ep-runtime'
    if (ep.runtime) rt.textContent = ep.runtime + 'm'

    info.appendChild(num)
    if (isCur) {
      var badge = document.createElement('div'); badge.className = 'vp-ep-now-playing'; badge.textContent = 'Now Playing'
      info.appendChild(badge)
    }
    info.appendChild(title)
    info.appendChild(rt)

    item.appendChild(thumb); item.appendChild(info)
    list.appendChild(item)

    item.addEventListener('click', function() {
      if (isCur) return
      cwSave()
      var title = currentItem.title.split(' \u00b7')[0] + ' \u00b7 S' + String(seasonNum).padStart(2,'0') + 'E' + String(ep.episode_number).padStart(2,'0')
      var next = {
        title:     title,
        tmdbId:    currentItem.tmdbId,
        type:      'tv',
        season:    seasonNum,
        episode:   ep.episode_number,
        posterPath: currentItem.posterPath,
      }
      closeEpPanel()
      stopExtraction()
      if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
      var v = document.getElementById('vpVideo'); v.pause(); v.src = ''
      openPlayer(next)
    })

    if (isCur) item.scrollIntoView({ block: 'center' })
  })
}

// ── PLAYER REMOTE CONTROL ─────────────────────────────────────────────────────

function handlePlayerKey(e) {
  var v = document.getElementById('vpVideo')

  switch (e.key) {
    case 'Escape': case 'GoBack': case 'BrowserBack':
      e.preventDefault()
      if (_epPanelOpen) { closeEpPanel() } else { closePlayer() }
      break

    case 'Enter': case ' ':
      e.preventDefault()
      if (v.paused) { v.play() } else { v.pause() }
      syncPlayIcon()
      showVpControls()
      break

    case 'ArrowRight':
      e.preventDefault()
      if (_epPanelOpen) break
      v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10)
      showVpControls()
      break

    case 'ArrowLeft':
      e.preventDefault()
      if (_epPanelOpen) break
      v.currentTime = Math.max(0, v.currentTime - 10)
      showVpControls()
      break

    case 'ArrowUp':
      e.preventDefault()
      showVpControls()
      break

    case 'ArrowDown':
      e.preventDefault()
      showVpControls()
      break
  }
}

// webOS back button keyCode
window.addEventListener('keydown', function(e) {
  if (document.getElementById('vpOverlay').classList.contains('hidden')) return
  if (e.keyCode === 461) {
    e.preventDefault()
    if (_epPanelOpen) { closeEpPanel() } else { closePlayer() }
  }
})

// ── SETUP ─────────────────────────────────────────────────────────────────────

function setupPlayer() {
  document.getElementById('vpBackBtn').addEventListener('click', function() { closePlayer() })

  document.getElementById('vpPlayBtn').addEventListener('click', function() {
    var v = document.getElementById('vpVideo')
    if (v.paused) { v.play() } else { v.pause() }
    syncPlayIcon()
    showVpControls()
  })

  document.getElementById('vpSkipBackBtn').addEventListener('click', function() {
    var v = document.getElementById('vpVideo')
    v.currentTime = Math.max(0, v.currentTime - 10)
    showVpControls()
  })

  document.getElementById('vpSkipFwdBtn').addEventListener('click', function() {
    var v = document.getElementById('vpVideo')
    v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10)
    showVpControls()
  })

  document.getElementById('vpPrevBtn').addEventListener('click', function() {
    if (!currentItem || currentItem.type !== 'tv') return
    var ep  = (currentItem.episode || 1) - 1
    var sea = currentItem.season  || 1
    if (ep < 1) return
    cwSave()
    var next = Object.assign({}, currentItem, { episode: ep })
    next.title = next.title.replace(/S\d+E\d+/, 'S' + String(sea).padStart(2,'0') + 'E' + String(ep).padStart(2,'0'))
    stopExtraction()
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
    var v = document.getElementById('vpVideo'); v.pause(); v.src = ''
    openPlayer(next)
  })

  document.getElementById('vpNextBtn').addEventListener('click', function() {
    if (!currentItem || currentItem.type !== 'tv') return
    var ep  = (currentItem.episode || 1) + 1
    var sea = currentItem.season  || 1
    cwSave()
    var next = Object.assign({}, currentItem, { episode: ep })
    next.title = next.title.replace(/S\d+E\d+/, 'S' + String(sea).padStart(2,'0') + 'E' + String(ep).padStart(2,'0'))
    stopExtraction()
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
    var v = document.getElementById('vpVideo'); v.pause(); v.src = ''
    openPlayer(next)
  })

  document.getElementById('vpEpListBtn').addEventListener('click', function() {
    if (_epPanelOpen) { closeEpPanel() } else { openEpPanel() }
  })

  document.getElementById('vpEpPanelClose').addEventListener('click', closeEpPanel)

  document.getElementById('vpQualityBtn').addEventListener('click', function() {
    document.getElementById('vpQualityMenu').classList.toggle('hidden')
  })

  document.querySelectorAll('.vp-srv-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = +btn.dataset.s
      if (currentItem) tryServer(idx)
    })
  })

  document.getElementById('vpFullBtn').addEventListener('click', function() {
    var el = document.getElementById('vpOverlay')
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      el.requestFullscreen && el.requestFullscreen()
    }
  })

  var v = document.getElementById('vpVideo')
  v.addEventListener('pause', syncPlayIcon)
  v.addEventListener('play',  syncPlayIcon)
}

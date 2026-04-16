'use strict'

// ── CONFIG ────────────────────────────────────────────────────────────────────

const PROXY_BASE  = 'https://jackflix-proxy.jackrherman.workers.dev'
const TMDB_TOKEN  = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4MjVlMzYzYTM3MDRhZDk5MTZlOTE4NzI3OWJjNjRkYyIsIm5iZiI6MTc3NjI4OTMwMC44MzgsInN1YiI6IjY5ZTAwNjE0OWMzOWYzNTRmODAxMmM0MCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.NSmPuuHTY8KGU4GTN4hz8_PVe9bxnXxmlfi5Ce5Co8A'
const IMG         = 'https://image.tmdb.org/t/p'

// ── TMDB HELPER ───────────────────────────────────────────────────────────────

function tmdb(ep, p = {}) {
  const url = new URL(`https://api.themoviedb.org/3${ep}`)
  Object.entries(p).forEach(([k, v]) => url.searchParams.set(k, v))
  return fetch(url, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then(r => r.json())
}

// ── PLAYER STATE ──────────────────────────────────────────────────────────────

let currentItem    = null   // { title, tmdbId, type, season, episode }
let extractionId   = 0
let hlsInstance    = null
let controlsTimer  = null
let serverIndex    = 0

const vid = () => document.getElementById('vid')

// ── OPEN PLAYER ───────────────────────────────────────────────────────────────

function openPlayer(item) {
  currentItem  = item
  serverIndex  = 0
  const el     = document.getElementById('player')
  el.classList.remove('hidden')
  document.getElementById('browse').style.visibility = 'hidden'
  document.getElementById('detail').classList.add('hidden')
  showPlayerLoading('Finding stream…')
  tryServer(0)
}

function closePlayer() {
  stopExtraction()
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
  const v = vid()
  v.pause(); v.src = ''
  document.getElementById('player').classList.add('hidden')
  document.getElementById('browse').style.visibility = 'visible'
  hidePlayerControls()
  currentItem = null
}

// ── STREAM EXTRACTION ─────────────────────────────────────────────────────────

let _extractCleanup = null

function stopExtraction() {
  if (_extractCleanup) { _extractCleanup(); _extractCleanup = null }
  const old = document.getElementById('jf-extract-iframe')
  if (old) old.remove()
}

async function tryServer(idx) {
  serverIndex = idx
  stopExtraction()
  showPlayerLoading(`Finding stream… (source ${idx + 1})`)
  syncServerBtns()

  extractionId++
  const myId = extractionId

  // Step 1: resolve stream URL via VPS
  let flixUrl
  try {
    const type    = currentItem.type
    const tmdbId  = currentItem.tmdbId
    const season  = currentItem.season  || 1
    const episode = currentItem.episode || 1

    // Server 0 = moviesapi/flixcdn, Server 1 = moviesapi/upn_url
    const qs = new URLSearchParams({ tmdbId, type, season, episode })
    const res = await fetch(`${PROXY_BASE}/api/resolve?${qs}`)
    if (!res.ok) throw new Error(`resolve ${res.status}`)
    const data = await res.json()

    const raw = idx === 0 ? data.video_url : (data.upn_url || data.video_url)
    if (!raw) throw new Error('no url')

    // Build proxied embed URL — hash fragment must be OUTSIDE the encoded part
    // so window.location.hash inside the iframe returns the video ID correctly
    const hashIdx = raw.indexOf('#')
    const base    = hashIdx !== -1 ? raw.slice(0, hashIdx) : raw
    const hash    = hashIdx !== -1 ? raw.slice(hashIdx)    : ''
    flixUrl = `${PROXY_BASE}/api/embed-proxy?url=${encodeURIComponent(base)}&ref=${encodeURIComponent(base)}${hash}`
  } catch (e) {
    if (extractionId !== myId) return
    if (idx < 1) { tryServer(idx + 1); return }
    showPlayerLoading('No stream found. Press Back.')
    return
  }

  // Step 2: load in hidden iframe, wait for jf-stream postMessage
  const iframe = document.createElement('iframe')
  iframe.id    = 'jf-extract-iframe'
  iframe.src   = flixUrl
  iframe.style.cssText = 'position:fixed;width:800px;height:450px;top:-9999px;left:-9999px;opacity:0;pointer-events:none;'
  document.body.appendChild(iframe)

  const timeout = setTimeout(() => {
    if (extractionId !== myId) return
    stopExtraction()
    window.removeEventListener('message', handler)
    if (serverIndex < 1) {
      tryServer(serverIndex + 1)
    } else {
      showPlayerLoading('No stream found. Press Back.')
    }
  }, 45_000)

  function handler(e) {
    if (extractionId !== myId) return
    if (!e.data || e.data.type !== 'jf-stream') return
    const url = e.data.url
    if (!url || !url.includes('.m3u8')) return
    clearTimeout(timeout)
    stopExtraction()
    window.removeEventListener('message', handler)
    if (!currentItem) return
    startPlayback(url)
  }

  window.addEventListener('message', handler)
  _extractCleanup = () => {
    clearTimeout(timeout)
    window.removeEventListener('message', handler)
  }
}

// ── PLAYBACK ──────────────────────────────────────────────────────────────────

function startPlayback(streamUrl) {
  const v = vid()
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
  hidePlayerLoading()
  showPlayerControls()

  if (Hls.isSupported()) {
    hlsInstance = new Hls({ enableWorker: true })
    hlsInstance.loadSource(streamUrl)
    hlsInstance.attachMedia(v)
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => { v.play() })
    hlsInstance.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal) showPlayerLoading('Playback error. Try another source.')
    })
  } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (webOS)
    v.src = streamUrl
    v.play()
  } else {
    showPlayerLoading('HLS not supported.')
    return
  }

  v.addEventListener('timeupdate', updateProgress)
}

function updateProgress() {
  const v = vid()
  if (!v.duration) return
  const pct = v.currentTime / v.duration * 100
  document.getElementById('pcSeekFill').style.width = pct + '%'
  document.getElementById('pcTime').textContent =
    `${fmt(v.currentTime)} / ${fmt(v.duration)}`
}

function fmt(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
    : `${m}:${String(ss).padStart(2,'0')}`
}

// ── CONTROLS UI ───────────────────────────────────────────────────────────────

function showPlayerLoading(msg) {
  document.getElementById('playerLoading').classList.remove('hidden')
  document.getElementById('playerLoadingMsg').textContent = msg
  hidePlayerControls()
}

function hidePlayerLoading() {
  document.getElementById('playerLoading').classList.add('hidden')
}

function showPlayerControls() {
  const pc = document.getElementById('playerControls')
  pc.classList.add('visible')
  resetControlsTimer()
}

function hidePlayerControls() {
  document.getElementById('playerControls').classList.remove('visible')
  if (controlsTimer) { clearTimeout(controlsTimer); controlsTimer = null }
}

function resetControlsTimer() {
  if (controlsTimer) clearTimeout(controlsTimer)
  controlsTimer = setTimeout(hidePlayerControls, 4000)
}

function syncServerBtns() {
  document.querySelectorAll('.pc-srv-btn').forEach((b, i) =>
    b.classList.toggle('active', i === serverIndex))
}

// ── PLAYER REMOTE CONTROL ─────────────────────────────────────────────────────

function handlePlayerKey(e) {
  const v = vid()
  const isPlaying = !v.paused && !v.ended

  switch (e.key) {
    case 'Escape':
    case 'GoBack':
    case 'BrowserBack':
      e.preventDefault()
      closePlayer()
      return true

    case 'Enter':
    case ' ':
      e.preventDefault()
      if (isPlaying) { v.pause() } else { v.play() }
      showPlayerControls()
      return true

    case 'ArrowRight':
      e.preventDefault()
      v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10)
      showPlayerControls()
      return true

    case 'ArrowLeft':
      e.preventDefault()
      v.currentTime = Math.max(0, v.currentTime - 10)
      showPlayerControls()
      return true

    case 'ArrowUp':
      e.preventDefault()
      showPlayerControls()
      return true

    case 'ArrowDown':
      e.preventDefault()
      showPlayerControls()
      return true
  }
  return false
}

// WebOS back key codes
window.addEventListener('keydown', e => {
  if (document.getElementById('player').classList.contains('hidden')) return
  if (e.keyCode === 461) { closePlayer(); e.preventDefault() }
})

// ── SETUP ─────────────────────────────────────────────────────────────────────

function setupPlayer() {
  // player title from currentItem
  document.getElementById('player').addEventListener('keydown', e => {
    handlePlayerKey(e)
  })

  // source switch buttons
  document.querySelectorAll('.pc-srv-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.s
      if (currentItem) tryServer(idx)
    })
  })
}

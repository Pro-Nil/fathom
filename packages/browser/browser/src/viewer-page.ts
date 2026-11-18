/**
 * The live-view page served at `/browser/view`: a toolbar, a tab strip and a
 * canvas showing the shared browser's screencast. Pointer, wheel and keyboard
 * input on the canvas go back to the same tab, so the user can take over at
 * any point. Self-contained (no external assets) so it works offline.
 * @module @pentest-harness/dsh-browser/src/viewer-page
 */

/** Complete HTML document for the live view. */
export const VIEWER_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Browser</title>
<style>
  :root {
    --bg: #0b0b0d; --bar: #141417; --field: #1d1d22; --line: rgba(255,255,255,.08);
    --text: #e8e8ec; --muted: #8b8b95; --accent: #3b82f6; --tab: #18181c; --tab-active: #24242a;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --bg: #f4f4f6; --bar: #ffffff; --field: #f0f0f3; --line: rgba(0,0,0,.08);
      --text: #17171a; --muted: #6b6b75; --tab: #ececf0; --tab-active: #ffffff;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
    font: 13px/1.3 Inter, 'Segoe UI', system-ui, sans-serif; overflow: hidden; }
  body { display: flex; flex-direction: column; }
  .tabs { display: flex; gap: 4px; padding: 6px 8px 0; background: var(--bar); overflow-x: auto; scrollbar-width: none; }
  .tab { display: flex; align-items: center; gap: 6px; max-width: 200px; min-width: 0; padding: 6px 8px 6px 10px;
    border-radius: 8px 8px 0 0; background: var(--tab); color: var(--muted); cursor: pointer; flex: none; }
  .tab.active { background: var(--tab-active); color: var(--text); }
  .tab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
  .tab button { all: unset; width: 16px; height: 16px; border-radius: 4px; text-align: center; line-height: 16px;
    color: var(--muted); cursor: pointer; }
  .tab button:hover { background: var(--line); color: var(--text); }
  .bar { display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: var(--tab-active);
    border-bottom: 1px solid var(--line); }
  .bar button { all: unset; width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center;
    color: var(--muted); cursor: pointer; flex: none; }
  .bar button:hover { background: var(--line); color: var(--text); }
  .bar svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 1.8;
    stroke-linecap: round; stroke-linejoin: round; }
  .url { flex: 1; min-width: 0; height: 28px; padding: 0 10px; border-radius: 7px; border: 1px solid transparent;
    background: var(--field); color: var(--text); font: inherit; outline: none; }
  .url:focus { border-color: var(--accent); }
  .stage { flex: 1; min-height: 0; position: relative; display: grid; place-items: center; }
  canvas { max-width: 100%; max-height: 100%; outline: none; display: block; cursor: default; }
  .note { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted);
    text-align: center; padding: 24px; pointer-events: none; }
  .toast { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); max-width: 90%;
    padding: 7px 12px; border-radius: 8px; background: #3a1d1d; color: #ffd7d7; font-size: 12px;
    opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<div class="tabs" id="tabs"></div>
<div class="bar">
  <button id="back" title="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
  <button id="forward" title="Forward"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
  <button id="reload" title="Reload"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button>
  <input class="url" id="url" spellcheck="false" autocomplete="off" placeholder="Enter a URL">
  <button id="newtab" title="New tab"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
</div>
<div class="stage" id="stage">
  <canvas id="screen" tabindex="0"></canvas>
  <div class="note" id="note">Starting the browser…</div>
  <div class="toast" id="toast"></div>
</div>
<script>
(() => {
  const params = new URLSearchParams(location.search)
  if (params.get('theme') === 'dark' || params.get('theme') === 'light') document.documentElement.dataset.theme = params.get('theme')
  const canvas = document.getElementById('screen')
  const g = canvas.getContext('2d')
  const note = document.getElementById('note')
  const toast = document.getElementById('toast')
  const urlInput = document.getElementById('url')
  const tabsEl = document.getElementById('tabs')
  const stage = document.getElementById('stage')
  let ws, view = { width: 0, height: 0 }, tabs = [], urlFocused = false, toastTimer, retry = 0

  function send(message) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(message)) }
  function showError(text) {
    toast.textContent = text; toast.classList.add('show')
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 4000)
  }

  function renderTabs() {
    tabsEl.textContent = ''
    for (const tab of tabs) {
      const el = document.createElement('div')
      el.className = 'tab' + (tab.active ? ' active' : '')
      el.title = tab.url
      const label = document.createElement('span')
      label.textContent = tab.title || tab.url || 'New tab'
      const close = document.createElement('button')
      close.textContent = '×'; close.title = 'Close tab'
      close.onclick = (e) => { e.stopPropagation(); send({ type: 'closeTab', tabId: tab.id }) }
      el.append(label, close)
      el.onclick = () => send({ type: 'selectTab', tabId: tab.id })
      tabsEl.append(el)
    }
    const active = tabs.find(t => t.active)
    if (active && !urlFocused) urlInput.value = active.url === 'about:blank' ? '' : active.url
  }

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/browser/ws')
    ws.onopen = () => { retry = 0; fit() }
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.type === 'frame') {
        const image = new Image()
        image.onload = () => {
          if (canvas.width !== image.width || canvas.height !== image.height) {
            canvas.width = image.width; canvas.height = image.height
          }
          g.drawImage(image, 0, 0)
          note.style.display = 'none'
        }
        image.src = 'data:image/jpeg;base64,' + message.data
        view = { width: message.width, height: message.height }
      } else if (message.type === 'tabs') {
        tabs = message.tabs; renderTabs()
      } else if (message.type === 'error') {
        showError(message.message)
        if (note.style.display !== 'none') note.textContent = message.message
      }
    }
    ws.onclose = () => {
      note.style.display = ''; note.textContent = 'Reconnecting to the browser…'
      setTimeout(connect, Math.min(5000, 500 * 2 ** retry++))
    }
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect()
    const width = view.width || canvas.width, height = view.height || canvas.height
    return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height }
  }
  const buttons = ['left', 'middle', 'right']
  canvas.addEventListener('mousedown', (e) => { canvas.focus(); e.preventDefault(); send({ type: 'mouse', action: 'down', button: buttons[e.button], clickCount: e.detail, ...point(e) }) })
  canvas.addEventListener('mouseup', (e) => { e.preventDefault(); send({ type: 'mouse', action: 'up', button: buttons[e.button], clickCount: e.detail, ...point(e) }) })
  let lastMove = 0
  canvas.addEventListener('mousemove', (e) => {
    const now = performance.now(); if (now - lastMove < 40) return; lastMove = now
    send({ type: 'mouse', action: 'move', ...point(e) })
  })
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); send({ type: 'mouse', action: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY, ...point(e) }) }, { passive: false })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('keydown', (e) => { e.preventDefault(); send({ type: 'key', action: 'down', key: e.key }) })
  canvas.addEventListener('keyup', (e) => { e.preventDefault(); send({ type: 'key', action: 'up', key: e.key }) })
  canvas.addEventListener('paste', (e) => { e.preventDefault(); send({ type: 'text', text: e.clipboardData.getData('text') }) })

  urlInput.addEventListener('focus', () => { urlFocused = true; urlInput.select() })
  urlInput.addEventListener('blur', () => { urlFocused = false; renderTabs() })
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && urlInput.value.trim()) { send({ type: 'navigate', url: urlInput.value.trim() }); canvas.focus() }
    if (e.key === 'Escape') { urlInput.blur() }
  })
  document.getElementById('back').onclick = () => send({ type: 'back' })
  document.getElementById('forward').onclick = () => send({ type: 'forward' })
  document.getElementById('reload').onclick = () => send({ type: 'reload' })
  document.getElementById('newtab').onclick = () => { send({ type: 'newTab' }); urlInput.focus() }

  // Keep the page viewport matched to the pane, like a responsive window.
  let fitTimer
  function fit() {
    clearTimeout(fitTimer)
    fitTimer = setTimeout(() => {
      const rect = stage.getBoundingClientRect()
      if (rect.width > 200 && rect.height > 200) send({ type: 'resize', width: Math.floor(rect.width), height: Math.floor(rect.height) })
    }, 250)
  }
  new ResizeObserver(fit).observe(stage)
  connect()
})()
</script>
</body>
</html>
`

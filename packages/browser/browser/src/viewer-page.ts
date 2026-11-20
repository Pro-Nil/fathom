/**
 * The live-view page served at `/browser/view`: a toolbar, a tab strip and a
 * canvas showing the shared browser's screencast. Pointer, wheel and keyboard
 * input on the canvas go back to the same tab, so the user can take over at
 * any point. Self-contained (no external assets) so it works offline.
 * @module @fathom/browser/src/viewer-page
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
  .toast.notice { background: #17301f; color: #d6f5df; }
  .menu { position: absolute; top: 42px; right: 8px; z-index: 5; min-width: 260px; padding: 4px;
    border-radius: 10px; border: 1px solid var(--line); background: var(--tab-active);
    box-shadow: 0 12px 32px rgba(0,0,0,.35); display: none; }
  .menu.open { display: block; }
  .menu button { all: unset; display: block; box-sizing: border-box; width: 100%; padding: 8px 10px;
    border-radius: 7px; cursor: pointer; color: var(--text); }
  .menu button:hover { background: var(--line); }
  .menu small { display: block; color: var(--muted); margin-top: 2px; }
  .sheet { position: absolute; inset: 0; z-index: 6; display: none; place-items: center;
    background: rgba(0,0,0,.45); }
  .sheet.open { display: grid; }
  .card { width: min(440px, calc(100% - 32px)); padding: 18px; border-radius: 12px;
    background: var(--tab-active); border: 1px solid var(--line); box-shadow: 0 16px 40px rgba(0,0,0,.4); }
  .card h2 { margin: 0 0 6px; font-size: 15px; }
  .card p { margin: 0 0 14px; color: var(--muted); line-height: 1.45; }
  .card ol { margin: 0 0 14px; padding-left: 18px; color: var(--muted); line-height: 1.5; }
  .card .row { display: flex; gap: 8px; justify-content: flex-end; }
  .card button { all: unset; padding: 7px 14px; border-radius: 8px; cursor: pointer;
    background: var(--field); color: var(--text); }
  .card button.primary { background: var(--accent); color: #fff; }
  .status { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); max-width: 90%;
    padding: 7px 12px; border-radius: 8px; background: var(--tab-active); color: var(--text);
    border: 1px solid var(--line); font-size: 12px; display: none; z-index: 4; }
  .status.show { display: block; }
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
  <button id="more" title="More: import passwords, password manager"><svg viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.7" fill="currentColor" stroke="none"/></svg></button>
</div>
<div class="menu" id="menu">
  <button id="import-passwords">Import saved passwords…<small>From Chrome, Brave, Edge or any browser's password export (CSV)</small></button>
  <button id="open-passwords">Open the password manager<small>See, edit or delete what this browser has saved</small></button>
</div>
<div class="stage" id="stage">
  <canvas id="screen" tabindex="0"></canvas>
  <div class="note" id="note">Starting the browser…</div>
  <div class="toast" id="toast"></div>
  <div class="status" id="status"></div>
  <div class="sheet" id="chooser">
    <div class="card">
      <h2>The page wants a file</h2>
      <p id="chooser-text">Choose the file to give to the page. It goes only to this browser.</p>
      <input type="file" id="chooser-input" hidden>
      <div class="row">
        <button id="chooser-cancel">Cancel</button>
        <button class="primary" id="chooser-pick">Choose file…</button>
      </div>
    </div>
  </div>
  <div class="sheet" id="import">
    <div class="card">
      <h2>Import saved passwords</h2>
      <ol>
        <li>In each browser you want to bring passwords from, export them to a CSV file:
          <b>Chrome</b> or <b>Brave</b>: Settings → Passwords (Password Manager) → Settings → Export passwords.
          <b>Edge</b>: Settings → Passwords → ⋯ → Export passwords.
          <b>Firefox</b>: Passwords → ⋯ → Export passwords.</li>
        <li>Choose all the exported files here at once. Sites you already saved here are kept.</li>
        <li>Delete the exported files afterwards; they hold your passwords in plain text.</li>
      </ol>
      <p>The browser closes and reopens while the passwords are saved; open tabs are not kept.</p>
      <input type="file" id="import-input" accept=".csv,text/csv" multiple hidden>
      <div class="row">
        <button id="import-cancel">Cancel</button>
        <button class="primary" id="import-go">Choose CSV files…</button>
      </div>
    </div>
  </div>
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
  function showNotice(text) {
    toast.textContent = text; toast.classList.add('show', 'notice')
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show', 'notice'), 9000)
  }
  function showError(text) {
    toast.classList.remove('notice')
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
      } else if (message.type === 'filechooser') {
        chooserInput.multiple = message.multiple === true
        document.getElementById('chooser-text').textContent = message.multiple
          ? 'Choose the files to give to the page. They go only to this browser.'
          : 'Choose the file to give to the page. It goes only to this browser.'
        chooserSheet.classList.add('open')
      } else if (message.type === 'notice') {
        showNotice(message.message)
      } else if (message.type === 'status') {
        statusEl.textContent = message.message
        statusEl.classList.toggle('show', Boolean(message.message))
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
  // ── menu, password import, file chooser ──────────────────────────────
  const statusEl = document.getElementById('status')
  const menu = document.getElementById('menu')
  const chooserSheet = document.getElementById('chooser')
  const chooserInput = document.getElementById('chooser-input')
  const importSheet = document.getElementById('import')
  document.getElementById('more').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open') }
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.classList.remove('open') })
  document.getElementById('import-passwords').onclick = () => { menu.classList.remove('open'); importSheet.classList.add('open') }
  document.getElementById('open-passwords').onclick = () => { menu.classList.remove('open'); send({ type: 'newTab', url: 'chrome://password-manager/passwords' }) }
  document.getElementById('import-cancel').onclick = () => importSheet.classList.remove('open')
  const importInput = document.getElementById('import-input')
  document.getElementById('import-go').onclick = () => importInput.click()
  importInput.addEventListener('change', async () => {
    const files = await readFiles([...importInput.files])
    importInput.value = ''
    importSheet.classList.remove('open')
    if (files.length > 0) send({ type: 'importPasswords', files })
  })
  function closeChooser(files) {
    chooserSheet.classList.remove('open')
    send({ type: 'files', files })
    chooserInput.value = ''
  }
  document.getElementById('chooser-cancel').onclick = () => closeChooser([])
  document.getElementById('chooser-pick').onclick = () => chooserInput.click()
  function readFiles(picked) {
    return Promise.all(picked.map(file => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({ name: file.name, mimeType: file.type, data: String(reader.result).split(',')[1] || '' })
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })))
  }
  chooserInput.addEventListener('change', async () => {
    closeChooser(await readFiles([...chooserInput.files]))
  })

  connect()
})()
</script>
</body>
</html>
`

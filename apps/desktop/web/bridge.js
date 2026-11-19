// Injected into the harness web UI by the desktop shell (Windows and Linux). It watches the UI's
// own event WebSocket for "a session needs the user" frames (a question from
// ask_user_question / plan review, or a tool approval) and tells the native
// shell, which plays the app's sound and shows a notification. It never
// changes, blocks or answers anything.
(() => {
  // Injected scripts can also reach child frames (for example the Browser
  // panel's live-view iframe); the bridge and status bar belong only to the
  // top document. The shell may inject twice (at document start and again
  // after load as a fallback); the second run is a no-op.
  if (window.top !== window || window.__phBridge) return
  window.__phBridge = true

  // The WebView adapter defines invokeCSharpAction once the page starts;
  // messages sent earlier wait in a queue.
  const outbox = []
  function deliver(text) {
    if (typeof window.invokeCSharpAction === 'function') { window.invokeCSharpAction(text); return true }
    if (window.chrome && window.chrome.webview) { window.chrome.webview.postMessage(text); return true }
    return false
  }
  function flush() {
    while (outbox.length > 0 && deliver(outbox[0])) outbox.shift()
    if (outbox.length > 0) setTimeout(flush, 100)
  }
  const post = (message) => {
    outbox.push(JSON.stringify(message))
    if (outbox.length === 1) flush()
  }
  const seen = new Set()
  const clip = (text, max) => {
    const flat = String(text || '').replace(/\s+/g, ' ').trim()
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
  }

  function report(frame, envelope) {
    if (frame.type === 'question/requested') {
      const key = 'q:' + (envelope && envelope.rpcId ? envelope.rpcId : frame.sessionId + JSON.stringify(frame.questions || []).slice(0, 200))
      if (seen.has(key)) return
      seen.add(key)
      const questions = Array.isArray(frame.questions) ? frame.questions : []
      const first = questions[0] || {}
      const plan = first.intent && first.intent.kind === 'plan-review'
      post({
        kind: plan ? 'plan' : 'question',
        key,
        sessionId: frame.sessionId,
        title: plan ? 'Plan ready for your review' : (questions.length > 1 ? questions.length + ' questions need your answer' : 'A question needs your answer'),
        body: clip(first.header ? first.header + ': ' + (first.question || '') : first.question, 180),
      })
    } else if (frame.type === 'approval/requested') {
      const key = 'a:' + (frame.approvalId || (envelope && envelope.rpcId))
      if (seen.has(key)) return
      seen.add(key)
      post({
        kind: 'approval',
        key,
        sessionId: frame.sessionId,
        title: 'Approval needed: ' + clip(frame.toolName, 40),
        body: clip(frame.reason || ('The agent wants to run ' + frame.toolName + '.'), 180),
      })
    } else if (frame.type === 'question/resolved' || frame.type === 'approval/resolved') {
      post({ kind: 'resolved', sessionId: frame.sessionId })
    }
  }

  function scan(node, parent, depth) {
    if (!node || typeof node !== 'object' || depth > 6) return
    if (typeof node.type === 'string' && /^(question|approval)\/(requested|resolved)$/.test(node.type)) {
      report(node, parent)
      return
    }
    for (const key in node) {
      const value = node[key]
      if (value && typeof value === 'object') scan(value, node, depth + 1)
    }
  }

  const NativeWebSocket = window.WebSocket
  class WatchedWebSocket extends NativeWebSocket {
    constructor(...args) {
      super(...args)
      this.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return
        if (event.data.indexOf('/requested') < 0 && event.data.indexOf('/resolved') < 0) return
        try { scan(JSON.parse(event.data), null, 0) } catch (_) { /* not JSON: ignore */ }
      })
    }
  }
  window.WebSocket = WatchedWebSocket

  // Tell the shell which palette the page shows, so the native title bar matches.
  let lastDark
  function reportTheme() {
    if (!document.body) return
    const dark = document.body.hasAttribute('data-ds-dark-theme')
    if (dark === lastDark) return
    lastDark = dark
    // The page fades its background (~0.16s); read the settled colour.
    setTimeout(() => post({ kind: 'theme', dark, background: getComputedStyle(document.body).backgroundColor }), 300)
  }
  function start() {
    reportTheme()
    new MutationObserver(reportTheme).observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
    mountTitleBar()
  }

  // ── Status bar ────────────────────────────────────────────────────────
  // A slim strip under the native title bar: the session name, the harness
  // state, how many sessions wait for the user, and reload / open in browser /
  // app menu buttons.
  const BAR = 34
  // Breathing room between the bar and the page's own header.
  const GAP = 6
  const icon = (d, extra) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"' + (extra || '') + '>' + d + '</svg>'
  const ICONS = {
    mark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2.5 19 5v6c0 4.9-2.8 8.6-7 10.5C7.8 19.6 5 15.9 5 11V5l7-2.5Z"/><circle cx="12" cy="11" r="3.4"/><circle cx="12" cy="11" r="1.1" fill="#3b82f6" stroke="none"/></svg>',
    reload: icon('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
    external: icon('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>'),
    more: icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', ' stroke-width="2.4"'),
  }
  const CSS = `
    #ph-titlebar { position: fixed; top: 0; left: 0; right: 0; height: ${BAR}px; z-index: 2147483000;
      display: flex; align-items: center; gap: 10px; padding-left: 14px; box-sizing: border-box;
      font: 12.5px/1 var(--dsw-font-family, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif);
      color: var(--dsw-alias-label-secondary, #9a9aa4); background: rgba(0, 0, 0, .035);
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.07)); user-select: none; }
    #ph-titlebar svg { display: block; flex: none; width: 16px !important; height: 16px !important; }
    #ph-titlebar .ph-mark { display: grid; place-items: center; color: var(--dsw-alias-label-primary, #ececf0); flex: none; }
    #ph-titlebar .ph-title { display: flex; align-items: baseline; gap: 7px; min-width: 0; overflow: hidden; white-space: nowrap; }
    #ph-titlebar .ph-session { color: var(--dsw-alias-label-primary, #ececf0); font-weight: 560; overflow: hidden; text-overflow: ellipsis; }
    #ph-titlebar .ph-sep { opacity: .45; }
    #ph-titlebar .ph-space { flex: 1; min-width: 12px; }
    #ph-titlebar .ph-pill { display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 9px; border-radius: 11px;
      background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); white-space: nowrap; flex: none; }
    #ph-titlebar .ph-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.15); }
    #ph-titlebar .ph-pill[data-state="attached"] .ph-dot { background: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }
    #ph-titlebar .ph-pill[data-state="starting"] .ph-dot { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.15); animation: ph-pulse 1.2s ease-in-out infinite; }
    #ph-titlebar .ph-pill[data-state="stopped"] .ph-dot { background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.15); }
    #ph-titlebar .ph-waiting { background: rgba(245,158,11,.16); color: #f5b041; font-weight: 560; }
    #ph-titlebar .ph-waiting[hidden] { display: none; }
    @keyframes ph-pulse { 50% { opacity: .35; } }
    #ph-titlebar button { all: unset; display: grid; place-items: center;
      height: ${BAR}px; color: var(--dsw-alias-label-secondary, #9a9aa4); cursor: default; flex: none; }
    #ph-titlebar .ph-tool { width: 30px; height: 28px; border-radius: 7px; }
    #ph-titlebar .ph-tool:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.15)); color: var(--dsw-alias-label-primary, #ececf0); }
    #ph-titlebar .ph-tools { display: flex; align-items: center; gap: 2px; margin-right: 8px; }
    body[data-ds-dark-theme] #ph-titlebar { background: rgba(0, 0, 0, .34); border-bottom-color: rgba(255, 255, 255, .06); }
    /* Reserve the bar's space with padding, not a margin on #root: a margin
       collapses through <body>, makes the document taller than the window, and
       lets the page scroll up under the bar. The page never scrolls as a whole. */
    html, body { overflow: hidden !important; }
    body { padding-top: ${BAR + GAP}px !important; box-sizing: border-box !important; }
    #root { height: 100% !important; margin-top: 0 !important; }
  `
  const chrome = { state: 'starting', port: 0, waiting: 0 }

  function mountTitleBar() {
    if (document.getElementById('ph-titlebar')) return
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    const bar = document.createElement('div')
    bar.id = 'ph-titlebar'
    bar.innerHTML =
      '<span class="ph-mark">' + ICONS.mark + '</span>' +
      '<span class="ph-title"><span class="ph-session"></span><span class="ph-sep">·</span><span class="ph-app">Pentest Harness</span></span>' +
      '<span class="ph-space"></span>' +
      '<span class="ph-pill ph-waiting" hidden></span>' +
      '<span class="ph-pill ph-status"><span class="ph-dot"></span><span class="ph-status-text"></span></span>' +
      '<span class="ph-tools">' +
        '<button class="ph-tool" data-action="reload" title="Reload">' + ICONS.reload + '</button>' +
        '<button class="ph-tool" data-action="external" title="Open in browser">' + ICONS.external + '</button>' +
        '<button class="ph-tool" data-action="menu" title="More">' + ICONS.more + '</button>' +
      '</span>'
    document.body.appendChild(bar)
    bar.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]')
      if (button) post({ kind: 'window', action: button.dataset.action })
    })
    renderChrome()
    // The harness keeps document.title as "<session> — Pentest Harness"; the
    // bar mirrors it (and never writes it back).
    new MutationObserver(renderTitle).observe(document.head, { subtree: true, childList: true, characterData: true })
    renderTitle()
    post({ kind: 'window', action: 'ready' })
  }

  function renderTitle() {
    const bar = document.getElementById('ph-titlebar')
    if (!bar) return
    const isApp = !!document.getElementById('root')
    const session = document.title.replace(/\s*[—·-]\s*Pentest Harness\s*$/, '').trim()
    const text = !isApp ? 'Starting' : session.length > 0 && session !== 'Pentest Harness' ? session : 'New session'
    const node = bar.querySelector('.ph-session')
    if (node.textContent !== text) node.textContent = text
  }

  function renderChrome() {
    const bar = document.getElementById('ph-titlebar')
    if (!bar) return
    const labels = { running: 'Running', attached: 'Attached', starting: 'Starting', stopped: 'Stopped' }
    const pill = bar.querySelector('.ph-status')
    pill.dataset.state = chrome.state
    pill.title = chrome.state === 'attached'
      ? 'Using a harness started outside the app'
      : chrome.state === 'running' ? 'Harness started by this app' : ''
    bar.querySelector('.ph-status-text').textContent = labels[chrome.state] + (chrome.port ? ' · :' + chrome.port : '')
    const waiting = bar.querySelector('.ph-waiting')
    waiting.hidden = !(chrome.waiting > 0)
    waiting.textContent = chrome.waiting === 1 ? '1 waiting for you' : chrome.waiting + ' waiting for you'
  }

  // The shell pushes its state with InvokeScript("window.__phChrome({...})").
  window.__phChrome = (data) => {
    if (!data || data.type !== 'chrome') return
    Object.assign(chrome, data)
    renderChrome()
  }

  // At document start the body does not exist yet; injected after load, it does.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()

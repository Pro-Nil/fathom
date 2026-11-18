// Injected into the harness web UI by the desktop shell. It watches the UI's
// own event WebSocket for "a session needs the user" frames (a question from
// ask_user_question / plan review, or a tool approval) and tells the native
// shell, which plays the app's sound and shows a notification. It never
// changes, blocks or answers anything.
(() => {
  if (!window.chrome || !window.chrome.webview) return
  const post = (message) => window.chrome.webview.postMessage(JSON.stringify(message))
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
  document.addEventListener('DOMContentLoaded', () => {
    reportTheme()
    new MutationObserver(reportTheme).observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
  })
})()

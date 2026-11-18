# @pentest-harness/dsh-client-ui-browser

English | [中文](README.zh.md)

The Web client's Browser pane. It occupies the layout's `aside` column, to the right of the conversation, which shrinks to make room instead of being covered. The column frames the live view that [`dsh-browser`](../../browser/browser/README.md) serves at `/browser/view`, so the user sees the same tabs the agent drives and can click, type and navigate in them.

The column's header has four buttons: reconnect the view, open it in a separate window, maximize or restore the column, and close it. Its left edge is a drag handle. While the column is closed, a **Browser** toggle in the `shell.overlay` slot opens it at 45% of the frame width.

The panel renders nothing while the column is closed, which drops the iframe, disconnects the viewer and stops the frame stream. Its only local state is a reconnect counter; open/closed, width and maximize state belong to the layout store.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No auto-open** — the column does not open by itself when the agent starts browsing; the user opens it with the toggle.
- **Geometry is transient** — like the rest of the layout, the column closes and forgets its width after a reload.

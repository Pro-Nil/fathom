/**
 * Browser pane plugin, node half. The empty apply gives Loader a host-side row
 * while the browser half ships through `exports["./client"]`; the live view it
 * frames is served by `@fathom/browser`.
 */

/** Host plugin body — this package contributes browser presentation only. */
export function apply(): void {}

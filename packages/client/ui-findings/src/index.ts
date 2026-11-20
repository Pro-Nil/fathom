/**
 * Findings pane plugin, node half. The empty apply gives the Loader a
 * host-side row while the browser half ships through `exports["./client"]`;
 * the live findings it renders come from the `findings` session projection
 * registered by `@fathom/tool-findings`.
 */

/** Host plugin body — this package contributes findings presentation only. */
export function apply(): void {}

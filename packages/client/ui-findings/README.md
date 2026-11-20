# @fathom/client-ui-findings

Findings surface for the Fathom Web client: a collapsible card in the composer dock that summarises the session's vulnerability findings and lets you drill into each one.

- **Collapsed:** a header row with the total and a coloured count chip per severity (critical → info). Click to expand.
- **Expanded:** severity stat tiles (click one to filter), a finding list, and a detail pane showing how each issue was found (evidence, with request/response and verbatim quotes), why it happens, how to reproduce it, and how to fix it.

It is a projection-mode surface: the live findings arrive through `useProjection('findings')` (the snapshot the host folds from `finding/change` session events, emitted by [`@fathom/tool-findings`](../../pentest/tool-findings/README.md)), so this plugin owns no store and no refresh chain. It is read-only — recording and updating findings stay with the agent's tools; the portable `findings-report.html` export remains for sharing.

Before the first finding is recorded (projection `null`/absent) or with an empty list, the card renders nothing.

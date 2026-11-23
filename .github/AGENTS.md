# AGENTS.md — GitHub Actions

Workflows in this repository:

- `ci.yml`: pull-request gates (lint, typecheck, unit, snapshot, build). Jobs run on Windows runners (`windows-*` labels) under native `pwsh`, except the `windows` job, which runs Windows Node under Wine on hosted Linux and blocks `all checks passed`.
- `e2e.yml`: real-API end-to-end tests; needs an API key secret.
- `build-exe-for-python-sdk.yml`: reusable workflow that builds the Python SDK's single-file runtime; called from `ci.yml`.
- `landlock-run.yml`: builds and tests the native Landlock launcher when `native/landlock-run/**` changes.
- `expected-filenames.yml`: rejects misspelled expected-snapshot file names.

There is no release or publish workflow: Fathom is installed from source (see [docs/UPDATING.md](../docs/UPDATING.md)).

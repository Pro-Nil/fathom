# Contributing

Thanks for your interest in Fathom.

## Reporting bugs and requesting features

Open an [issue](https://github.com/Pro-Nil/fathom/issues) using the bug or feature template. For bugs, include your OS, Node.js version, how you run Fathom (web or desktop app), the model provider, and the steps to reproduce. **Never paste API keys, session logs from real engagements, or target details you are not allowed to share.**

Security problems in Fathom itself (for example a scope-gate bypass or a way for target output to make the agent act) should not be described in a public issue. Open an issue that only says you have a security report, with no details, and a private channel will be arranged.

## Pull requests

For anything beyond a small fix, open an issue first so the approach can be agreed before you write code.

1. Set up a checkout with [docs/development.md](docs/development.md).
2. Read [docs/architecture.md](docs/architecture.md) before changing anything under `packages/`, and follow the rules in [AGENTS.md](AGENTS.md).
3. Add or update tests next to the code you change ([docs/testing.md](docs/testing.md)) and update the package README when behavior changes.
4. Keep each commit to one logical change with a clear message.

## Plugins

Fathom is built so that you rarely need to change this repository: almost everything is a plugin you can add beside the built-in ones. See [your first plugin](docs/plugins/first-plugin.md). If you publish one, tag the GitHub project with the `fathom-plugin` topic so others can find it.

# Skill packs

Curated third-party skills that `scripts/install-skill-pack.ts` installs into your user skill root (`$FATHOM_HOME/skills`, default `~/.fathom/skills`) as flat `<name>.md` files. The `skill-filesystem` provider picks them up automatically; a running harness sees them on its next catalog refresh.

```sh
pnpm skills:bug-bounty                                   # install or update
pnpm skills:bug-bounty --dry-run                         # show what would change
pnpm skills:bug-bounty --uninstall                       # remove what the pack installed
tsx scripts/install-skill-pack.ts bug-bounty --dest DIR  # install somewhere else
```

## How a pack is pinned

Each manifest names a GitHub repository, a full commit sha, and the SHA-256 of every file. The installer downloads from that commit only and refuses any file whose bytes or frontmatter `name` do not match, so it can only install content that was reviewed when the manifest was written. It never overwrites a skill you already have under the same name (unless `--force`), and `--uninstall` removes only files that are still exactly what the pack installed.

## `bug-bounty`

29 web/API hunting, validation and reporting skills selected from [S1N6H/Bug-Bounty-Skills](https://github.com/S1N6H/Bug-Bounty-Skills), which aggregates skills from many authors. This pack draws from:

- [0x002132/skills-bugbounty](https://github.com/0x002132/skills-bugbounty): `hunt-dispatch` (router), recon, the `hunt-*` vulnerability classes, triage, evidence hygiene, report writing
- [Aetherdz/huntpack](https://github.com/Aetherdz/huntpack): `false-positive-killer`, `application-model-builder`, `domain-scoped-hunting`

Each skill stays under its original author's license; check the author repository before redistributing.

Selection notes:

- **Kept small on purpose.** Every installed skill's name and description is listed in each model request, so installing the full aggregate (3,000+ files) would cost tens of thousands of tokens per step. Skill bodies load only when the agent calls `skill(name)`.
- **Left out:** red-team, OSINT-on-people, cloud-identity and smart-contract material, niche product skills (SharePoint, ASP.NET, NTLM), and `hunt-rce` / `hunt-xxe` / `hunt-llm-ai`, which an automated scan flagged for closer review. `hunt-dispatch` still names some of these; loading one that is not installed simply reports it as not found.
- **Read before use.** These are third-party instructions for authorized testing. Follow your program's rules of engagement where a skill suggests brute force, high request rates, or touching other users' data.

To update the pin, review the new upstream content, then regenerate the manifest's `commit` and `sha256` values from the exact bytes at that commit.

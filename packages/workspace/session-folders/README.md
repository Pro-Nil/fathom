# @pentest-harness/dsh-session-folders

Gives each session its own folder inside its workspace, so sessions in the same workspace stop writing to the same files.

A session's folder is `<workspace>/<folder>/<title-slug>/` (default `<workspace>/sessions/<title>/`). The shell (`bash`, `pwsh`), file (`read`, `write`, `edit`) and search (`glob`, `grep`) tools start there: commands run in it and relative paths resolve against it. The session's recorded `cwd` stays the workspace, so workspace membership, the sandbox root and cross-session queries do not change, and the agent can still reach the rest of the workspace by path.

## How a folder is chosen

- The folder is assigned the first time a tool needs it. If the session only has the instant first-prompt title so far, the service waits up to `titleWaitMs` for the model-written title.
- A `.dsh-session` file inside the folder records the owning session id. A restarted harness or a renamed session finds and keeps the same folder.
- A name another session already owns gets a numeric suffix (`recon-2`).
- A subagent or fork (`parentSession`) shares its parent's folder.
- A session that existed before the service started and has no folder keeps working in the workspace root, so an engagement already in progress does not move.
- With no title service, the folder is `session-<last 8 characters of the id>`.

The runtime context tells the model which folder it is in once one is assigned.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Give each new session its own folder. |
| `folder` | `sessions` | Parent folder, relative to the workspace. Must stay inside it. |
| `titleWaitMs` | `15000` | How long to wait for a model-written title before naming the folder. |
| `settings` | `false` | Register the `session-folders` settings namespace, so `enabled` and `folder` can be changed under Settings → Plugins. |

## For tool authors

`toolWorkdir(ctx, agent, root)` returns the session folder when the service is mounted and the folder lies inside `root`, and `root` unchanged otherwise. Call it where a tool would otherwise default to `agent.session.header.cwd`.

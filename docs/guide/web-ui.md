# Use the Web UI

Start the Web UI through the [root README](../../README.md#quick-start); the command prints its URL. This guide begins after that server is running. The `fathom` process uses its invoking directory as the default filesystem location, but a fresh Web UI has no selected workspace until you add one.

## Configure a model

Open **Settings → Models**, choose **Add provider**, pick your provider (or **Add a custom provider** for any OpenAI-compatible endpoint), paste its API key, and save. The model route becomes usable immediately without restarting the server.

The [model configuration guide](models.md) covers other providers and custom OpenAI-compatible endpoints.

## Choose a workspace

Click **Choose workspace**, add the project directory where you started `fathom`, and select it. The session composer remains unavailable until a workspace is selected.

## Run a task

Start a session and send:

> Summarize this repository and identify its main packages.

The agent can read and edit workspace files, run commands, delegate work, and maintain a plan. The Web UI asks before operations that require approval under the active permission policy.

## Continue

- [Configure models](models.md)
- [Use the Python SDK](python-sdk.md)
- [Use other CLI modes](../../apps/cli/README.md)
- [Develop a plugin](../plugins/first-plugin.md)

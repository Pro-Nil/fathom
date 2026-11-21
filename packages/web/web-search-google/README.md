# @fathom/web-search-google

Google search for the web seam (`ctx.web`). Two providers register:

| Provider id | How it searches | Needs |
| --- | --- | --- |
| `google` | Loads `google.com/search` in a hidden page of the harness's shared browser (same profile and cookies as the user's sign-ins), then reads the result titles, links and snippets. The page never appears in the tab list or the live view. | The `browser` plugin (mounted by the web app). No key. |
| `google-api` | Calls the Programmable Search JSON API. | `GOOGLE_API_KEY` and `GOOGLE_CSE_ID`, stored as credentials or set in the environment. |

A CAPTCHA or "unusual traffic" page, an HTTP error or a timeout is reported as a provider error. With `searchFallback` on (the shipped default), `ctx.web` then tries the next engine: Google, Google API (only when its key is stored), Bing, DuckDuckGo, Exa, Perplexity. The engine and the fallback are chosen under **Settings → Plugins → Web search** and apply to the next search.

## Config

```yaml
- id: web-search-google
  name: '@fathom/web-search-google'
  config:
    language: en              # `hl` for the keyless provider
    apiKeyEnv: GOOGLE_API_KEY # credential reference of the API key
    engineIdEnv: GOOGLE_CSE_ID
    timeoutMs: 20000
```

## Model Experience

### Search results

#### What the model sees

Nothing new: both providers serve the existing `web_search` tool, whose result lists each source's title, URL and snippet. When the seam fell back, the result starts with a line naming the engine that answered and why the earlier ones failed.

#### Token effect

Same as any `web_search` result; a fallback adds one short line.

#### KV Cache effect

None: results arrive as tool output at the end of the conversation.

## Known Limitations and Deferred Work

- **Google may still block the browser** — heavy use can trigger Google's CAPTCHA; the seam then falls back, and solving the CAPTCHA once in the browser pane usually clears it.
- **Result markup changes** — the keyless provider reads Google's result HTML, so a markup change can return fewer results until the selectors are updated.
- **API quota** — the Programmable Search API's free tier is 100 queries a day.

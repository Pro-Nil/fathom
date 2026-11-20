# @fathom/web-search-duckduckgo

A keyless search provider for the `ctx.web` seam. It posts the query to DuckDuckGo's JavaScript-free results page (`https://html.duckduckgo.com/html/`) and returns each organic result's URL, title and snippet. No account, API key or payment is needed, so `web_search` works out of the box.

- Sponsored results and duplicate URLs are skipped.
- DuckDuckGo's `/l/?uddg=` redirect links are unwrapped to the real destination.
- There is no generated answer (`content` is omitted); the model reads the sources.
- If DuckDuckGo throttles the client (HTTP 202 or a challenge page), the search fails with `WEB_PROVIDER_ERROR` and a message to retry shortly.

The base bundle selects it with `searchProvider: duckduckgo` on the `web` row. The model provider stays registered; switch `searchProvider` back to `acme-official` to use it with a API key.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `baseURL` | `https://html.duckduckgo.com/html/` | Results page the query is posted to. |
| `region` | none | Region code sent as `kl`, for example `us-en` or `in-en`. |

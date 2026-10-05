# WakaTime MCP for Cloudflare Workers

An authenticated remote MCP server for WakaTime summaries. The Cloudflare Worker exposes the `wakatime_summaries` and `wakatime_today` tools over Streamable HTTP at `/mcp`.
 
## Local development

Use Node.js 24 and npm. Install dependencies and create an ignored `.dev.vars` file containing your own values:

```text
WAKATIME_API_KEY=<your WakaTime API key>
MCP_AUTH_TOKEN=<a long random token for MCP clients>
```

Keep `.dev.vars` private. Start the Worker with:

```sh
npm ci
npm run dev
```

Wrangler serves the endpoint at `http://localhost:8787/mcp`. Each MCP request must include `Authorization: Bearer <MCP_AUTH_TOKEN>`.

Run checks with:

```sh
npm test
npm run build
```

The build script typechecks TypeScript and runs Wrangler's deployment dry run. Neither the test suite nor build needs live WakaTime or Cloudflare credentials.

## Tools

- `wakatime_summaries` accepts required valid `start` and `end` dates in `YYYY-MM-DD` format (`start` must be on or before `end`), plus optional `project` and IANA `timezone` values. Omitting `timezone` uses the WakaTime account's timezone.
- `wakatime_today` accepts optional `project` and `timezone` values. The default timezone is `Asia/Tokyo`.

Both tools use `GET https://api.wakatime.com/api/v1/users/current/summaries` with the documented `timezone` query parameter. Today's date is calculated in the same timezone sent to WakaTime. API-key authentication uses `Authorization: Basic <base64(API_KEY)>`, without adding a username/password colon, and requests accept JSON. Successful results preserve the complete summaries JSON envelope, including daily and aggregate fields.

Upstream failures return MCP tool results with `isError: true`. Diagnostics include HTTP status, status text, sanitized `error`/`errors` messages, endpoint, and query parameter names. Request context contains no query values. Known credentials and named credential values are redacted; unrelated response fields and raw non-JSON bodies are excluded. Network and response-stream exceptions use controlled messages.

Requests are not retried automatically. HTTP 429 includes rate-limit guidance and a valid `Retry-After` header when supplied. WakaTime also documents 302 redirects as possible rate limiting; redirects are reported without following them. The [official API docs](https://wakatime.com/developers) document `error`/`errors`, but do not guarantee their nested structure or a `Retry-After` header.

## Deploy

Set the WakaTime API key and the separate MCP bearer token as Cloudflare Worker secrets. Wrangler prompts for each secret value:

```sh
npx wrangler secret put WAKATIME_API_KEY
npx wrangler secret put MCP_AUTH_TOKEN
npm run deploy
```

The Worker requires both secrets at runtime. An unset MCP token rejects all requests. Keep the WakaTime API key in the Worker secret store; it is not part of the build or GitHub Actions deployment environment.

## Configure an MCP client

Use the deployed Worker URL with `/mcp` and supply the bearer token in the `Authorization` header. For clients with HTTP header configuration, the shape is:

```json
{
  "url": "https://<worker-name>.<account-subdomain>.workers.dev/mcp",
  "headers": {
    "Authorization": "Bearer <MCP_AUTH_TOKEN>"
  }
}
```

The client only needs the MCP bearer token. Never provide it with the WakaTime API key.

## CI and deployment

GitHub Actions runs separate `test`, `build`, and `deploy` jobs. The build job runs after tests succeed; deployment waits for both test and build. Deployment runs only on a push to `main`. Configure these repository Actions secrets:

- `CLOUDFLARE_API_TOKEN` with permission to deploy Workers.
- `CLOUDFLARE_ACCOUNT_ID` for the Cloudflare account.

Set `WAKATIME_API_KEY` and `MCP_AUTH_TOKEN` directly in Cloudflare with Wrangler before using the deployed endpoint. CI never reads or prints those values.

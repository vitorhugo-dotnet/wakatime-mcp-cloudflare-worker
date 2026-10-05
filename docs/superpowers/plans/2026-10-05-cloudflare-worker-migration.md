# Cloudflare Worker MCP Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Port the existing WakaTime MCP tools to an authenticated, stateless Cloudflare Worker endpoint at `/mcp`, with local Wrangler support, CI gates, and deployment documentation.

**Architecture:** Move WakaTime API and date helpers into a Worker-compatible module that accepts environment bindings, then register the existing tools on an MCP v2 server factory consumed by Agents' stateless `createMcpHandler`. A Worker fetch entrypoint checks a constant-time bearer-token comparison before forwarding requests to the Streamable HTTP MCP handler. Wrangler config, GitHub Actions, and README document and validate the runtime.

**Tech Stack:** TypeScript, `@modelcontextprotocol/server` v2, Cloudflare `agents/mcp/server` stateless handler, Wrangler, Zod 4, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-05-cloudflare-worker-migration-design.md`

## Global Constraints

- Use stateless Streamable HTTP at `/mcp`; no Durable Objects, KV, Redis, or other persisted state.
- Retain tools `wakatime_summaries` and `wakatime_today`, existing validation, timezone handling, and WakaTime query behavior.
- Read `WAKATIME_API_KEY` and `MCP_AUTH_TOKEN` only from Worker bindings; never expose either in responses, build output, or logs.
- Require a valid `Authorization: Bearer <MCP_AUTH_TOKEN>` header before every MCP request reaches the handler.
- Production deploys only for pushes to `main`; deploy requires both test and build jobs to pass.
- Set `WAKATIME_API_KEY` as a Cloudflare Worker secret and Cloudflare deployment credentials as GitHub Actions secrets.

## Review Focus

- Missing/empty configured secrets and missing/invalid bearer headers must fail closed before invoking the MCP handler; test in Task 2.
- Wrong authorization scheme, malformed header, and token mismatch must return 401 without reflecting header/token data; test in Task 2.
- Non-`/mcp` paths must return 404, and auth must cover all methods at `/mcp`; test in Task 2.
- Invalid tool arguments and invalid timezones must return protocol errors without leaking the WakaTime key; test in Task 1.
- Upstream WakaTime non-2xx responses and error text must not reveal the configured key; test in Task 1.

---

### Task 1: Move WakaTime tools to an environment-aware MCP server

**Files:**
- Create: `src/wakatime.ts`
- Create: `src/server.ts`
- Modify: `tests/basicAuthHeaderFromApiKey.test.ts`
- Modify: `tests/basicAuthHeaderFromApiKey.test.js`
- Delete: `tests/entrypoint.test.ts`
- Delete: `tests/entrypoint.test.js`
- Create: `tests/wakatime.test.ts`
- Create: `tests/server.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- `src/wakatime.ts` exports `Env` with optional `WAKATIME_API_KEY?: string` and `MCP_AUTH_TOKEN?: string` bindings, `basicAuthHeaderFromApiKey(apiKey: string): string`, `todayYmd(tz?: string): string`, and `wakatimeGet(env: Env, path: string, qs: Record<string, string | undefined>): Promise<string>`.
- `src/server.ts` exports `createServer(env: Env): McpServer`, registering the two existing tool names, input schemas, and behavior against those helpers.
- Remove stdio transport and CLI entrypoint detection; `src/index.ts` becomes the Worker entrypoint in Task 2.

- [x] **Step 1: Add WakaTime helper tests first**

In `tests/wakatime.test.ts`, cover Basic auth encoding, timezone date formatting with a fixed clock, query construction, authorization from the passed binding, missing API key rejection, non-2xx response handling, and that error text does not include the configured key. Update both existing Basic auth tests to import from `../src/wakatime.js`; remove the entrypoint tests because the CLI behavior they cover is intentionally removed.

- [x] **Step 2: Run the helper tests and confirm they fail for missing exports/behavior**

Run: `npm test -- tests/wakatime.test.ts`
Expected: failures identify the not-yet-created environment-aware helpers.

- [x] **Step 3: Implement Worker-safe WakaTime helpers**

Move the existing API and date logic to `src/wakatime.ts`; pass `Env` explicitly and do not read `process.env`. Preserve endpoint, query names, Basic auth encoding, response text, and timezone default. Use Web Platform APIs rather than Node-only `Buffer`. Throw a status-based error for upstream failures without appending upstream response bodies.

- [x] **Step 4: Add tool registration tests first**

In `tests/server.test.ts`, pass `createServer` to `createMcpHandler` and issue Streamable HTTP JSON-RPC initialize, tools/list, and tools/call requests. Assert exactly `wakatime_summaries` and `wakatime_today`; call both with valid inputs and controlled fetch responses; assert summary query fields, timezone conversion to `tz`, and same-day start/end for today. Assert malformed arguments and invalid timezones produce MCP protocol errors.

- [x] **Step 5: Run server tests and confirm they fail against the missing factory**

Run: `npm test -- tests/server.test.ts`
Expected: failures identify the missing `createServer` export or tool behavior.

- [x] **Step 6: Add compatible MCP server dependencies and implement `createServer(env)`**

Add `agents@0.26.0`, its required `@modelcontextprotocol/server@2.0.0` peer, and update `@modelcontextprotocol/sdk` to `^1.30.0` to match Agents' required peer; retain Zod 4. Use `McpServer` and its `registerTool` API in `src/server.ts`; expose the existing tool names and descriptions with equivalent schemas. Register handlers that call `wakatimeGet` and `todayYmd`. Remove `StdioServerTransport`, `shouldRunMain`, `realpathSync`, `pathToFileURL`, direct process environment access, and CLI startup behavior from the existing implementation. Remove the package `bin` and `prepare` entries from `package.json`; remove `scripts/add-shebang.js` if no references remain.

- [x] **Step 7: Run all tests and build**

Run: `npm test`
Expected: all existing and new tests pass.

Run: `npx tsc --noEmit -p .`
Expected: exit 0 with no type errors.

### Task 2: Add the authenticated stateless Worker endpoint

**Files:**
- Create: `src/auth.ts`
- Modify: `src/index.ts`
- Create: `tests/auth.test.ts`
- Create: `tests/worker.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`

**Interfaces:**
- `src/auth.ts` exports `isAuthorized(request: Request, expectedToken?: string): Promise<boolean>`; reject a missing/empty expected token, parse the Bearer scheme case-insensitively, SHA-256 hash both token strings with Web Crypto, and compare fixed-length digest bytes without early exit.
- `src/index.ts` exports default `{ fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }`; handle only `/mcp`, authenticate first, then create a request-scoped handler using `createMcpHandler(() => createServer(env), { route: "/mcp" })` and delegate the request. The env binding is captured in the factory because `createMcpHandler`'s server factory receives MCP request context, not the Cloudflare env object. The MCP SDK v2 handler is stateless by default; do not pass the v1-only `transport` option.

- [x] **Step 1: Write authorization tests**

In `tests/auth.test.ts`, assert valid bearer succeeds, scheme matching is case-insensitive, and missing header, wrong scheme, malformed header, wrong token, and empty expected token fail.

- [x] **Step 2: Run authorization tests and confirm they fail because the helper is absent**

Run: `npm test -- tests/auth.test.ts`
Expected: failures identify the missing `isAuthorized` helper.

- [x] **Step 3: Implement constant-time bearer validation**

Add the exact `isAuthorized` interface above and compare the two SHA-256 digests by accumulating XOR differences across all bytes.

- [x] **Step 4: Write Worker request tests**

In `tests/worker.test.ts`, call the exported fetch handler with Cloudflare-like bindings. Assert unauthenticated and invalid-token POST requests to `/mcp` return 401; send an unauthenticated `tools/call` request and assert the mocked WakaTime fetch is never called, proving rejection occurs before tool execution. A valid token must allow JSON-RPC initialize and tools/list exchanges and return both tools; non-`/mcp` paths return 404. Assert no response body or headers contain either configured secret.

- [x] **Step 5: Run Worker tests and confirm they fail before adding the fetch handler**

Run: `npm test -- tests/worker.test.ts`
Expected: failures identify the missing Worker export or endpoint behavior.

- [x] **Step 6: Add Cloudflare Worker types and implement the fetch entrypoint**

Add `@cloudflare/workers-types` as a development dependency and include its ambient types in the TypeScript configuration as needed. Wrap the stateless `createMcpHandler` with route and bearer checks, passing bindings to the server factory. Make the token check occur before parsing or forwarding the MCP request. Return JSON-RPC-compatible MCP handler responses unchanged; use 401 for authentication failure and 404 for other paths. Do not log authorization values or request bodies.

- [x] **Step 7: Run protocol tests and typecheck**

Run: `npm test`
Expected: all tests pass, including a full MCP initialize and tools/list exchange over Streamable HTTP.

Run: `npx tsc --noEmit -p .`
Expected: exit 0 with no Worker or MCP type errors.

### Task 3: Add Wrangler setup, deployment CI, and usage documentation

**Files:**
- Create: `wrangler.jsonc`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `.github/workflows/deploy.yml`
- Modify: `README.md`

**Interfaces:**
- Wrangler points to `src/index.ts`, uses a stable Worker name and an explicit current compatibility date, and declares no persistent bindings or secret values.
- Scripts: `dev` runs `wrangler dev`; `build` runs TypeScript checking and `wrangler deploy --dry-run`; `deploy` runs `wrangler deploy`; `test` remains `vitest run`.
- Local secret file `.dev.vars` is ignored by git and holds only developer-supplied `WAKATIME_API_KEY` and `MCP_AUTH_TOKEN` values.
- Workflow jobs are named `test`, `build`, and `deploy`; `build.needs` is `test`; `deploy.needs` is `[test, build]`; deployment condition permits only `push` events on `refs/heads/main`.

- [x] **Step 1: Add Wrangler config and scripts**

Create `wrangler.jsonc` for the Worker entrypoint and compatibility date. Add Wrangler as a development dependency and set the `dev`, `build`, and `deploy` scripts to the exact behavior above. Keep the package free of CLI `bin` packaging. Update `.gitignore` to ignore `.dev.vars`.

- [x] **Step 2: Verify local Wrangler development and dry-run build**

Run: `npm run build`
Expected: TypeScript check and Wrangler dry-run complete successfully without account credentials or secret values.

Run: `npm run dev -- --port 8787` with placeholder local-only secrets set in an ignored `.dev.vars`; from a separate command, send an unauthenticated request and then authenticated JSON-RPC initialize and tools/list requests to `http://127.0.0.1:8787/mcp`.
Expected: Wrangler starts, the unauthenticated request returns 401, and authenticated initialize and tools/list return 200 with both tools. Stop only the dev process started for this check.

- [x] **Step 3: Add the GitHub Actions workflow**

Create `.github/workflows/deploy.yml` for pushes and pull requests. Each job uses Node.js 24 and independently runs `npm ci`. The test job runs `npm test`; the build job declares `needs: test` and runs `npm run build`; the deploy job declares `needs: [test, build]`, has an `if` condition for pushes to `main`, and runs Wrangler deploy with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from GitHub Actions secrets. Do not pass `WAKATIME_API_KEY` through the build or Actions workflow.

- [x] **Step 4: Document local and production operations**

Update README to explain that this is a remote Streamable HTTP MCP server, local Wrangler use, `/mcp`, Bearer authentication, how to create `.dev.vars`, how to set both Worker secrets with Wrangler, remote client header configuration, CI job dependencies and branch gating, and required Cloudflare GitHub secrets. Do not include sample credential values that look usable or any real secrets.

- [x] **Step 5: Run complete checks and inspect the final diff**

Run: `npm ci --cache /workspace/.npm-cache --no-audit --no-fund`
Expected: clean frozen-lockfile installation; `prepare` must not invoke the removed CLI shebang build.

Run: `npm test && npm run build`
Expected: all tests pass and Wrangler dry-run completes.

Run: `git diff --check`
Expected: no whitespace errors.

Inspect `.github/workflows/deploy.yml` to confirm `build.needs: test`, `deploy.needs: [test, build]`, `main`-only deploy condition, and no WakaTime secret reference; inspect `git status --short` to distinguish intended local `.dev.vars` and ignored build outputs from tracked changes.

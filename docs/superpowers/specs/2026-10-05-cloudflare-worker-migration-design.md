# Cloudflare Worker MCP Migration Design

## Goal

Port the WakaTime MCP server from local stdio to a stateless Cloudflare Worker using Streamable HTTP at `/mcp`, retain both existing tools, and provide tested local development and gated production deployment workflows.

## Constraints

- Do not add Durable Objects, KV, Redis, or other persistent state.
- Keep `wakatime_summaries`, `wakatime_today`, their input validation, timezone handling, and WakaTime request behavior.
- The Worker reads `WAKATIME_API_KEY` from its Cloudflare secret binding. Never return it in tool output or write it to logs/build output.
- Require a separate `MCP_AUTH_TOKEN` bearer credential for every MCP request. Reject missing or incorrect credentials before running tools; do not expose anonymous account-backed API access.
- Use `/mcp` for remote Streamable HTTP requests and Wrangler for local execution and deployment.
- Remove the local CLI bootstrap and packaging behavior that depend on stdio, `process.argv`, filesystem realpath checks, and `process.exit`.
- CI has separate `test`, `build`, and `deploy` jobs. `build` requires `test`; `deploy` requires both and runs only for pushes to `main`. Use GitHub Actions secrets for Cloudflare credentials. The WakaTime key is set as a Cloudflare Worker secret, not injected into build artifacts.
- Preserve TLS and package integrity checks; do not alter application source or dependency declarations to bypass failures.

## Architecture

The Worker HTTP entrypoint serves `/mcp` using Cloudflare's supported stateless MCP Streamable HTTP handler. Construct the existing MCP server and its handlers through a request-scoped factory so each HTTP exchange has no durable server-side session. The handler receives the Worker environment (`WAKATIME_API_KEY`, `MCP_AUTH_TOKEN`) explicitly; application code must not read `process.env`.

Authentication middleware validates `Authorization: Bearer <MCP_AUTH_TOKEN>` before passing a request to the MCP handler. Missing and invalid credentials receive HTTP 401 without invoking the tools. Requests outside `/mcp` receive an appropriate not-found response. The same check applies to every MCP HTTP method, including initialization and follow-up calls.

Retain the existing WakaTime request and tool behavior behind an environment-aware server factory. Keep date/timezone and validation helpers independently testable. Avoid logging request headers, credentials, or WakaTime response bodies on errors if they could contain sensitive data.

## Configuration and delivery

Add Wrangler configuration for the Worker entrypoint, Worker name, and compatibility date; do not put secret values in it. Add package scripts for Wrangler local development, validation/build, deploy, and removal of CLI-only build steps as appropriate. Local developers configure `WAKATIME_API_KEY` and `MCP_AUTH_TOKEN` through an ignored local secrets file; production stores them with `wrangler secret put`.

Add a GitHub Actions workflow with independent install-and-test and install-and-build jobs, plus a deploy job that declares `needs: [test, build]`. Deploy only on `push` to `main`, use the Cloudflare API token and account ID from Actions secrets, and never print secret values. A failed test or Worker build/dry-run must prevent deployment.

Update the README with local Wrangler use, local and production secret setup, remote `/mcp` configuration and bearer authentication, CI behavior, and deployment requirements.

## Validation

- Unit tests preserve both existing WakaTime tool behaviors and input validation without requiring live WakaTime credentials.
- HTTP tests exercise `/mcp` initialization and tool discovery over Streamable HTTP, authentication rejection before tool execution, valid bearer authentication, and non-MCP paths.
- Verify WakaTime API calls use the supplied binding and retain query/auth behavior with controlled fetch responses; ensure errors do not leak the configured API key.
- `npm test`, TypeScript/build validation, and `wrangler deploy --dry-run` (or the supported equivalent) must pass locally before deploy is considered ready.
- Inspect the GitHub Actions workflow to confirm dependency edges and `main` branch gating; no live Cloudflare deployment is required for local validation.

## Out of scope

- Cloudflare deployment credentials or live production deployment during implementation.
- Persisted MCP sessions, Durable Objects, queues, databases, or caching.
- Changes to WakaTime API product behavior or additional MCP tools.
- Anonymous, IP-based, or third-party identity authentication; this migration uses the configured shared bearer token.

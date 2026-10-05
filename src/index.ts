// ABOUTME: Cloudflare Worker entrypoint for the authenticated WakaTime MCP server.
// ABOUTME: The MCP handler and server are request-scoped to avoid durable sessions.
import { createMcpHandler } from "agents/mcp/server";
import { isAuthorized } from "./auth.js";
import { createServer } from "./server.js";
import type { Env } from "./wakatime.js";

const unauthorized = () =>
  Response.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );

const notFound = () => new Response("Not found", { status: 404 });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname !== "/mcp") return notFound();
    if (!(await isAuthorized(request, env.MCP_AUTH_TOKEN))) return unauthorized();

    const handler = createMcpHandler(() => createServer(env), { route: "/mcp" });
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

// ABOUTME: Registers the WakaTime MCP tools against explicit Worker bindings.
// ABOUTME: A fresh instance is created for each stateless HTTP exchange.
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "./wakatime.js";
import { todayYmd, wakatimeGet } from "./wakatime.js";

const summariesInput = z
  .object({
    start: z.string().min(1).describe("YYYY-MM-DD"),
    end: z.string().min(1).describe("YYYY-MM-DD"),
    project: z.string().optional(),
    timezone: z.string().optional().describe("例: Asia/Tokyo"),
  })
  .strict();

const todayInput = z
  .object({
    project: z.string().optional(),
    timezone: z.string().optional().describe("例: Asia/Tokyo"),
  })
  .strict();

export function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "wakatime-mcp", version: "0.0.2" });

  server.registerTool(
    "wakatime_summaries",
    {
      description: "WakaTime Summaries API を叩き、指定期間の日次サマリ(JSON)を返します。",
      inputSchema: summariesInput,
    },
    async ({ start, end, project, timezone }) => {
      const json = await wakatimeGet(env, "users/current/summaries", {
        start,
        end,
        project,
        tz: timezone,
      });
      return { content: [{ type: "text", text: json }] };
    },
  );

  server.registerTool(
    "wakatime_today",
    {
      description: "今日のサマリ(JSON)を返します（Asia/Tokyo をデフォルトにします）。",
      inputSchema: todayInput,
    },
    async ({ project, timezone }) => {
      const tz = timezone ?? "Asia/Tokyo";
      const date = todayYmd(tz);
      const json = await wakatimeGet(env, "users/current/summaries", {
        start: date,
        end: date,
        project,
        tz,
      });
      return { content: [{ type: "text", text: json }] };
    },
  );

  return server;
}

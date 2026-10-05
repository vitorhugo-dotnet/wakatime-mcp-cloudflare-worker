import { createMcpHandler } from "agents/mcp/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";

function createRpcHandler(apiKey = "secret-key") {
  return createMcpHandler(() => createServer({ WAKATIME_API_KEY: apiKey }), {
    route: "/mcp",
    allowedHostnames: ["example.com"],
    allowedOriginHostnames: [],
    corsOptions: false,
  });
}

async function rpc(
  handler: ReturnType<typeof createRpcHandler>,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await handler.fetch(
    new Request("https://example.com/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Host: "example.com",
      },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${text}`);
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text.split("\n").find((line) => line.startsWith("data: "));
    if (!data) throw new Error(`MCP event stream had no data: ${text}`);
    return JSON.parse(data.slice("data: ".length));
  }
  return text ? JSON.parse(text) : undefined;
}

async function initialize(handler: ReturnType<typeof createRpcHandler>) {
  return rpc(handler, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("WakaTime MCP server", () => {
  it("registers the two existing tools", async () => {
    const handler = createRpcHandler();
    await initialize(handler);
    const result = await rpc(handler, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }) as { result: { tools: Array<{ name: string }> } };

    expect(result.result.tools.map((tool) => tool.name).sort()).toEqual([
      "wakatime_summaries",
      "wakatime_today",
    ]);
  });

  it("calls summaries with the existing parameters and API key binding", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v1/users/current/summaries");
      expect(url.searchParams.get("start")).toBe("2025-01-01");
      expect(url.searchParams.get("end")).toBe("2025-01-02");
      expect(url.searchParams.get("project")).toBe("demo");
      expect(url.searchParams.get("tz")).toBe("Asia/Tokyo");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Basic c2VjcmV0LWtleQ==");
      return new Response('{"data":[]}', { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const handler = createRpcHandler();
    await initialize(handler);
    const result = await rpc(handler, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "wakatime_summaries",
        arguments: { start: "2025-01-01", end: "2025-01-02", project: "demo", timezone: "Asia/Tokyo" },
      },
    });

    expect(result).toMatchObject({ result: { content: [{ type: "text", text: '{"data":[]}' }] } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses one date in the requested timezone for today's summary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T02:00:00.000Z"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("start")).toBe("2024-12-31");
      expect(url.searchParams.get("end")).toBe("2024-12-31");
      expect(url.searchParams.get("tz")).toBe("America/Los_Angeles");
      return new Response('{"data":[]}', { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const handler = createRpcHandler();
    await initialize(handler);
    await rpc(handler, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "wakatime_today", arguments: { timezone: "America/Los_Angeles" } },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns protocol errors for invalid input without exposing the API key", async () => {
    const handler = createRpcHandler();
    await initialize(handler);
    const result = await rpc(handler, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "wakatime_summaries", arguments: { start: "", end: "2025-01-02" } },
    });
    expect(result).toMatchObject({ result: { isError: true } });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("rejects unexpected arguments instead of silently stripping them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handler = createRpcHandler();
    await initialize(handler);
    const result = await rpc(handler, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "wakatime_summaries",
        arguments: { start: "2025-01-01", end: "2025-01-02", unexpected: "value" },
      },
    });
    expect(result).toMatchObject({ result: { isError: true } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid timezone before making a WakaTime request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handler = createRpcHandler();
    await initialize(handler);
    const result = await rpc(handler, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "wakatime_today", arguments: { timezone: "Not/A_Timezone" } },
    });
    expect(result).toMatchObject({ result: { isError: true } });
    expect(JSON.stringify(result)).not.toContain("secret-key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

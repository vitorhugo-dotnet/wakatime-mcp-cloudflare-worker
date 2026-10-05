import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";

const env = {
  WAKATIME_API_KEY: "wakatime-secret-key",
  MCP_AUTH_TOKEN: "remote-mcp-token",
};

function jsonRpcRequest(body: Record<string, unknown>, token?: string) {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Host: "localhost",
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function readJsonRpc(response: Response): Promise<unknown> {
  const body = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = body.split("\n").find((line) => line.startsWith("data: "));
    if (!data) throw new Error(`No JSON-RPC data in event stream: ${body}`);
    return JSON.parse(data.slice("data: ".length));
  }
  return body ? JSON.parse(body) : undefined;
}

afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare Worker MCP endpoint", () => {
  it("rejects missing and invalid credentials without exposing either secret", async () => {
    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    };

    for (const token of [undefined, "wrong-token"]) {
      const response = await worker.fetch(jsonRpcRequest(initialize, token), env, {} as ExecutionContext);
      const text = await response.text();
      expect(response.status).toBe(401);
      expect(text).not.toContain(env.MCP_AUTH_TOKEN);
      expect(text).not.toContain(env.WAKATIME_API_KEY);
      expect([...response.headers.values()].join(" ")).not.toContain(env.MCP_AUTH_TOKEN);
      expect([...response.headers.values()].join(" ")).not.toContain(env.WAKATIME_API_KEY);
    }
  });

  it("rejects tool calls before they can make a WakaTime request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      jsonRpcRequest(
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wakatime_today", arguments: {} } },
      ),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires authentication for MCP GET and DELETE requests too", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await worker.fetch(
        new Request("http://localhost/mcp", { method }),
        env,
        {} as ExecutionContext,
      );
      expect(response.status).toBe(401);
    }
  });

  it("serves initialize and tool discovery with a valid token", async () => {
    const initialize = await worker.fetch(
      jsonRpcRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
          },
        },
        env.MCP_AUTH_TOKEN,
      ),
      env,
      {} as ExecutionContext,
    );
    expect(initialize.status).toBe(200);
    expect(await readJsonRpc(initialize)).toMatchObject({ result: { serverInfo: { name: "wakatime-mcp" } } });

    const listing = await worker.fetch(
      jsonRpcRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, env.MCP_AUTH_TOKEN),
      env,
      {} as ExecutionContext,
    );
    expect(listing.status).toBe(200);
    const result = await readJsonRpc(listing) as { result: { tools: Array<{ name: string }> } };
    expect(result.result.tools.map((tool) => tool.name).sort()).toEqual([
      "wakatime_summaries",
      "wakatime_today",
    ]);
  });

  it("runs both WakaTime tools through the authenticated Worker binding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T02:00:00.000Z"));
    const requestedUrls: URL[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Basic d2FrYXRpbWUtc2VjcmV0LWtleQ==");
      return new Response('{"data":[{"grand_total":"1 hr"}]}', { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await worker.fetch(
      jsonRpcRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
          },
        },
        env.MCP_AUTH_TOKEN,
      ),
      env,
      {} as ExecutionContext,
    );

    const summaries = await worker.fetch(
      jsonRpcRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "wakatime_summaries",
            arguments: { start: "2025-01-01", end: "2025-01-02", timezone: "Asia/Tokyo" },
          },
        },
        env.MCP_AUTH_TOKEN,
      ),
      env,
      {} as ExecutionContext,
    );
    const today = await worker.fetch(
      jsonRpcRequest(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "wakatime_today", arguments: { timezone: "America/Los_Angeles" } },
        },
        env.MCP_AUTH_TOKEN,
      ),
      env,
      {} as ExecutionContext,
    );

    expect(summaries.status).toBe(200);
    expect(await readJsonRpc(summaries)).toMatchObject({
      result: { content: [{ text: '{"data":[{"grand_total":"1 hr"}]}' }] },
    });
    expect(today.status).toBe(200);
    expect(await readJsonRpc(today)).toMatchObject({
      result: { content: [{ text: '{"data":[{"grand_total":"1 hr"}]}' }] },
    });
    expect(requestedUrls.map((url) => url.searchParams.get("start"))).toEqual([
      "2025-01-01",
      "2024-12-31",
    ]);
    expect(requestedUrls.map((url) => url.searchParams.get("end"))).toEqual([
      "2025-01-02",
      "2024-12-31",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 404 outside the MCP endpoint", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/other"),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(404);
  });

  it("fails closed when the authentication binding is not configured", async () => {
    const response = await worker.fetch(
      jsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, env.MCP_AUTH_TOKEN),
      { WAKATIME_API_KEY: env.WAKATIME_API_KEY },
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
  });
});

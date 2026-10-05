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

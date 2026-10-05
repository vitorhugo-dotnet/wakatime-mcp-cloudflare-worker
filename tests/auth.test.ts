import { describe, expect, it } from "vitest";
import { isAuthorized } from "../src/auth.js";

describe("isAuthorized", () => {
  it("accepts the configured bearer token", async () => {
    const request = new Request("https://example.com/mcp", {
      headers: { Authorization: "Bearer correct-token" },
    });
    await expect(isAuthorized(request, "correct-token")).resolves.toBe(true);
  });

  it("accepts the case-insensitive Bearer scheme", async () => {
    const request = new Request("https://example.com/mcp", {
      headers: { Authorization: "bEaReR correct-token" },
    });
    await expect(isAuthorized(request, "correct-token")).resolves.toBe(true);
  });

  it.each([
    ["missing authorization", undefined],
    ["wrong scheme", "Basic correct-token"],
    ["malformed scheme", "Bearer"],
    ["wrong token", "Bearer another-token"],
  ])("rejects %s", async (_label, authorization) => {
    const headers = new Headers();
    if (authorization) headers.set("Authorization", authorization);
    await expect(isAuthorized(new Request("https://example.com/mcp", { headers }), "correct-token"))
      .resolves.toBe(false);
  });

  it("rejects an absent or empty configured token", async () => {
    const request = new Request("https://example.com/mcp", {
      headers: { Authorization: "Bearer anything" },
    });
    await expect(isAuthorized(request)).resolves.toBe(false);
    await expect(isAuthorized(request, "")).resolves.toBe(false);
  });
});

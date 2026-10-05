// ABOUTME: Unit tests for Worker-safe auth header encoding.
// ABOUTME: Verifies the basic auth header format for WakaTime API keys.
import { describe, expect, it } from "vitest";

import { basicAuthHeaderFromApiKey } from "../src/wakatime.js";

describe("basicAuthHeaderFromApiKey", () => {
  it("encodes API key as base64 in Basic auth header", () => {
    expect(basicAuthHeaderFromApiKey("abc")).toBe("Basic YWJj");
  });
  it("matches the official example without adding a password colon", () => {
    expect(basicAuthHeaderFromApiKey("12345")).toBe("Basic MTIzNDU=");
  });
  it("uses UTF-8 for API key encoding", () => {
    expect(basicAuthHeaderFromApiKey("café")).toBe("Basic Y2Fmw6k=");
  });
});

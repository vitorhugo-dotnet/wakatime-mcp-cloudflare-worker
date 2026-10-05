import { afterEach, describe, expect, it, vi } from "vitest";
import { basicAuthHeaderFromApiKey, todayYmd, wakatimeGet } from "../src/wakatime.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("basicAuthHeaderFromApiKey", () => {
  it("encodes the API key using WakaTime Basic authentication", () => {
    expect(basicAuthHeaderFromApiKey("abc")).toBe("Basic YWJj");
  });
});

describe("todayYmd", () => {
  it("formats today's date in the requested timezone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T02:00:00.000Z"));
    expect(todayYmd("America/Los_Angeles")).toBe("2024-12-31");
  });
});

describe("wakatimeGet", () => {
  it("uses the environment binding and encodes query values", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://api.wakatime.com/api/v1/users/current/summaries?start=2025-01-01&end=2025-01-02&project=sample+project&timezone=Asia%2FTokyo",
      );
      expect(new Headers(init?.headers).get("Authorization")).toBe("Basic c2VjcmV0LWtleQ==");
      expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      return new Response('{"data":[]}', { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      wakatimeGet(
        { WAKATIME_API_KEY: "secret-key" },
        "users/current/summaries",
        { start: "2025-01-01", end: "2025-01-02", project: "sample project", timezone: "Asia/Tokyo" },
      ),
    ).resolves.toBe('{"data":[]}');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects when the API key binding is missing", async () => {
    await expect(wakatimeGet({}, "users/current/summaries", {})).rejects.toThrow(/WAKATIME_API_KEY/);
  });

  it("reports upstream status without dumping non-JSON response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret-key", { status: 401 })));
    await expect(
      wakatimeGet({ WAKATIME_API_KEY: "secret-key" }, "users/current/summaries", {}),
    ).rejects.toThrow("WakaTime API request failed: 401");
    await expect(
      wakatimeGet({ WAKATIME_API_KEY: "secret-key" }, "users/current/summaries", {}),
    ).rejects.not.toThrow(/secret-key/);
  });
});

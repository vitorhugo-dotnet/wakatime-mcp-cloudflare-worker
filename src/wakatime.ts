// ABOUTME: Worker-safe WakaTime API and timezone helpers.
// ABOUTME: All credentials arrive through explicit Cloudflare environment bindings.

export interface Env {
  WAKATIME_API_KEY?: string;
  MCP_AUTH_TOKEN?: string;
}

export function basicAuthHeaderFromApiKey(apiKey: string): string {
  const bytes = new TextEncoder().encode(apiKey);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export function todayYmd(tz = "Asia/Tokyo"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("today date formatting failed");
  return `${year}-${month}-${day}`;
}

export async function wakatimeGet(
  env: Env,
  path: string,
  qs: Record<string, string | undefined>,
): Promise<string> {
  const apiKey = env.WAKATIME_API_KEY;
  if (!apiKey) {
    throw new Error("環境変数 WAKATIME_API_KEY が未設定です（WakaTimeのAPI Key）。");
  }

  const url = new URL(`https://api.wakatime.com/api/v1/${path}`);
  for (const [key, value] of Object.entries(qs)) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: basicAuthHeaderFromApiKey(apiKey),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`WakaTime API error: ${response.status}`);
  }
  return response.text();
}

// ABOUTME: Validates the shared bearer token used to protect the MCP endpoint.
// ABOUTME: Comparison uses fixed-length digests and does not stop on a byte mismatch.

const encoder = new TextEncoder();

export async function isAuthorized(
  request: Request,
  expectedToken?: string,
): Promise<boolean> {
  if (!expectedToken) return false;

  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer[\t ]+([^\s]+)$/i);
  const providedToken = match?.[1];
  if (!providedToken) return false;

  const [expectedDigest, providedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken)),
    crypto.subtle.digest("SHA-256", encoder.encode(providedToken)),
  ]);
  const expectedBytes = new Uint8Array(expectedDigest);
  const providedBytes = new Uint8Array(providedDigest);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index]! ^ providedBytes[index]!;
  }
  return difference === 0;
}

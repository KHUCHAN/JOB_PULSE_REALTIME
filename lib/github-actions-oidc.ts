const EXPECTED_ISSUER = "https://token.actions.githubusercontent.com";
const EXPECTED_AUDIENCE = "job-pulse-realtime";
const EXPECTED_REPOSITORY = "KHUCHAN/JOB_PULSE_REALTIME";
const EXPECTED_REF = "refs/heads/main";
const EXPECTED_WORKFLOW_REF = `${EXPECTED_REPOSITORY}/.github/workflows/production-crawl.yml@${EXPECTED_REF}`;
const JWKS_URL = `${EXPECTED_ISSUER}/.well-known/jwks`;

type GithubActionsClaims = {
  aud?: unknown;
  event_name?: unknown;
  exp?: unknown;
  iat?: unknown;
  iss?: unknown;
  nbf?: unknown;
  ref?: unknown;
  repository?: unknown;
  workflow_ref?: unknown;
};

type JwtHeader = { alg?: unknown; kid?: unknown; typ?: unknown };
type GithubJwk = JsonWebKey & { kid?: string };
type JwksPayload = { keys?: GithubJwk[] };

let cachedKeys: { expiresAt: number; keys: GithubJwk[] } | null = null;

const base64UrlBytes = (value: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid JWT encoding.");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const jwtJson = <T>(value: string): T => JSON.parse(new TextDecoder().decode(base64UrlBytes(value))) as T;

const audienceMatches = (audience: unknown): boolean => audience === EXPECTED_AUDIENCE
  || (Array.isArray(audience) && audience.includes(EXPECTED_AUDIENCE));

const claimsAreAllowed = (claims: GithubActionsClaims, nowSeconds: number): boolean => {
  const eventName = claims.event_name;
  const clockSkewSeconds = 60;
  return claims.iss === EXPECTED_ISSUER
    && audienceMatches(claims.aud)
    && claims.repository === EXPECTED_REPOSITORY
    && claims.ref === EXPECTED_REF
    && claims.workflow_ref === EXPECTED_WORKFLOW_REF
    // The production workflow also runs on an explicitly scoped `push` to
    // main so changes to the crawler cannot wait for the next cron tick.
    // Repository/ref/workflow_ref are still pinned above, so this does not
    // authorize tokens from forks or feature branches.
    && (eventName === "schedule" || eventName === "workflow_dispatch" || eventName === "push")
    && typeof claims.exp === "number"
    && claims.exp >= nowSeconds - clockSkewSeconds
    && typeof claims.iat === "number"
    && claims.iat <= nowSeconds + clockSkewSeconds
    && (claims.nbf === undefined || (typeof claims.nbf === "number" && claims.nbf <= nowSeconds + clockSkewSeconds));
};

const githubJwks = async (fetcher: typeof fetch, nowMs: number): Promise<GithubJwk[]> => {
  if (cachedKeys && cachedKeys.expiresAt > nowMs) return cachedKeys.keys;
  const response = await fetcher(JWKS_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GitHub OIDC keys returned HTTP ${response.status}.`);
  const payload = await response.json() as JwksPayload;
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  if (keys.length === 0) throw new Error("GitHub OIDC keys were unavailable.");
  cachedKeys = { keys, expiresAt: nowMs + 60 * 60 * 1_000 };
  return keys;
};

export const clearGithubActionsOidcCacheForTest = (): void => {
  cachedKeys = null;
};

export async function verifyGithubActionsOidc(
  authorization: string | null,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<boolean> {
  const token = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!token || token.length > 16_384) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    const header = jwtJson<JwtHeader>(encodedHeader);
    const claims = jwtJson<GithubActionsClaims>(encodedClaims);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 256) return false;
    if (!claimsAreAllowed(claims, Math.floor(now.getTime() / 1_000))) return false;
    const keys = await githubJwks(fetcher, now.getTime());
    const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig"));
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlBytes(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
    );
  } catch {
    return false;
  }
}

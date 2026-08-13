import { beforeEach, describe, expect, it } from "vitest";
import { clearGithubActionsOidcCacheForTest, verifyGithubActionsOidc } from "./github-actions-oidc";

const base64Url = (value: Uint8Array | string): string => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
};

const signedToken = async (overrides: Record<string, unknown> = {}) => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const now = Math.floor(new Date("2026-08-12T22:00:00Z").getTime() / 1_000);
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: "https://token.actions.githubusercontent.com",
    aud: "job-pulse-realtime",
    repository: "KHUCHAN/JOB_PULSE_REALTIME",
    ref: "refs/heads/main",
    workflow_ref: "KHUCHAN/JOB_PULSE_REALTIME/.github/workflows/production-crawl.yml@refs/heads/main",
    event_name: "schedule",
    iat: now - 10,
    nbf: now - 10,
    exp: now + 300,
    ...overrides,
  }));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { token: `${header}.${claims}.${base64Url(new Uint8Array(signature))}`, jwk: { ...publicKey, kid: "test-key", use: "sig" } };
};

describe("GitHub Actions OIDC", () => {
  beforeEach(clearGithubActionsOidcCacheForTest);

  it("accepts the scheduled production workflow token", async () => {
    const { token, jwk } = await signedToken();
    const fetcher: typeof fetch = async () => Response.json({ keys: [jwk] });
    await expect(verifyGithubActionsOidc(`Bearer ${token}`, fetcher, new Date("2026-08-12T22:00:00Z"))).resolves.toBe(true);
  });

  it("rejects tokens from another repository or branch", async () => {
    const { token, jwk } = await signedToken({ repository: "attacker/fork" });
    const fetcher: typeof fetch = async () => Response.json({ keys: [jwk] });
    await expect(verifyGithubActionsOidc(`Bearer ${token}`, fetcher, new Date("2026-08-12T22:00:00Z"))).resolves.toBe(false);
  });

  it("rejects malformed and expired tokens without requesting keys", async () => {
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests += 1;
      return Response.json({ keys: [] });
    };
    await expect(verifyGithubActionsOidc("Bearer not-a-jwt", fetcher)).resolves.toBe(false);
    const { token } = await signedToken({ exp: 1 });
    await expect(verifyGithubActionsOidc(`Bearer ${token}`, fetcher, new Date("2026-08-12T22:00:00Z"))).resolves.toBe(false);
    expect(requests).toBe(0);
  });
});

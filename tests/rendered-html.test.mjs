import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Job Pulse overview contract", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Job Pulse Realtime/);
  assert.match(html, /src="\/brand\/job-pulse-logo\.png"/);
  assert.match(html, /Automatic · every 2 hours/);
  assert.match(html, /Every 2 hours/);
  assert.match(html, /Loading overview/);
  assert.doesNotMatch(html, /Crawl now/);
  assert.doesNotMatch(html, /Next Talent tasks/);
});

test("server-renders Talent Harness as a provider-only directory", async () => {
  const response = await render("/talent");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Provider only/);
  assert.match(html, /Nothing runs inside Job Pulse/);
  assert.match(html, /Verified Talent directory/);
  assert.match(html, /Loading Talent queue/);
  assert.doesNotMatch(html, /Start assisted flow/);
  assert.doesNotMatch(html, /Mark completed/);
  assert.doesNotMatch(html, /Mark blocked/);
});

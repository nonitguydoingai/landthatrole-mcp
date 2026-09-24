// Run: npm test (in mcp-server/). Drives the real MCP handler with JSON-RPC requests, using a
// stand-in jobs API so no network is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildServer, siteApi } from "../src/server.ts";

const JOB = {
  id: "gh-stripe-123",
  title: "Senior Software Engineer, Payments",
  company: "Stripe",
  location: "Toronto, Ontario",
  country: "CA",
  work_mode: "hybrid",
  salary: { min: 150000, max: 190000, currency: "CAD", period: "year" },
  posted_at: "2026-09-20T10:00:00.000Z",
  url: "https://www.landthatrole.com/job/gh-stripe-123",
  apply_url: "https://boards.greenhouse.io/stripe/jobs/123",
  source: "greenhouse",
  skills: ["Go"],
  open: true,
};

function fakeApi(responses) {
  const calls = [];
  return {
    calls,
    async get(path, params = {}) {
      calls.push({ path, params });
      const r = responses[path];
      return typeof r === "function" ? r(params) : r ?? { status: 404, body: { error: "Not found" } };
    },
  };
}

async function rpc(api, method, params) {
  const handler = createMcpHandler(() => buildServer(api));
  const res = await handler.fetch(
    new Request("https://mcp.test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  );
  const text = await res.text();
  // A response can come back as JSON or as one SSE event
  const json = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))?.slice(5);
  return { status: res.status, body: JSON.parse(json) };
}

test("lists three read-only tools with titles and annotations", async () => {
  const { body } = await rpc(fakeApi({}), "tools/list", {});
  const tools = body.result.tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), ["get_job", "list_job_categories", "search_jobs"]);
  for (const t of tools) {
    assert.ok(t.title, `${t.name} has a title`);
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.annotations.destructiveHint, false);
  }
});

test("search_jobs passes filters to the API and returns text plus structured results", async () => {
  const api = fakeApi({
    "/api/v1/jobs": () => ({ status: 200, body: { total: 29, offset: 0, limit: 10, next_offset: 10, jobs: [JOB] } }),
  });
  const { body } = await rpc(api, "tools/call", {
    name: "search_jobs",
    arguments: { query: "react", country: "CA", work_mode: ["remote", "hybrid"], salary_min: 120000 },
  });
  assert.deepEqual(api.calls[0].params, {
    q: "react", role: undefined, country: "CA", city: undefined, work_mode: "remote,hybrid", salary_min: 120000,
    posted_within_days: undefined, sort: undefined, limit: 10, offset: undefined,
  });
  const result = body.result;
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.total, 29);
  assert.equal(result.structuredContent.next_offset, 10);
  const text = result.content[0].text;
  assert.match(text, /29 open jobs match \(showing 1–1\)/);
  assert.match(text, /Senior Software Engineer, Payments · Stripe/);
  assert.match(text, /CAD 150,000–190,000 per year/);
  assert.match(text, /Apply: https:\/\/boards\.greenhouse\.io\/stripe\/jobs\/123/);
  assert.match(text, /offset 10/);
});

test("search_jobs rejects invalid arguments before calling the API", async () => {
  const api = fakeApi({});
  const { body } = await rpc(api, "tools/call", { name: "search_jobs", arguments: { country: "UK" } });
  assert.equal(body.result?.isError ?? !!body.error, true);
  assert.equal(api.calls.length, 0);
});

test("API errors come back as tool errors with the API's message", async () => {
  const api = fakeApi({ "/api/v1/jobs": { status: 400, body: { error: 'Unknown role "astronaut". See /api/v1/categories for the role slugs.' } } });
  const { body } = await rpc(api, "tools/call", { name: "search_jobs", arguments: { role: "astronaut" } });
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /Unknown role/);
});

test("get_job shows the description and says when a posting is closed", async () => {
  const api = fakeApi({
    "/api/v1/jobs/gh-stripe-123": {
      status: 200,
      body: { ...JOB, open: false, employment_type: "Full-time", description: "Build payments.", description_truncated: false },
    },
  });
  const { body } = await rpc(api, "tools/call", { name: "get_job", arguments: { id: "gh-stripe-123" } });
  const text = body.result.content[0].text;
  assert.match(text, /closed by the employer/);
  assert.match(text, /Build payments\./);
  assert.match(text, /Employment type: Full-time/);
});

test("siteApi builds the URL, skips empty params and forwards the caller's IP", async () => {
  let seen;
  const fetcher = async (url, init) => {
    seen = { url, headers: init.headers };
    return new Response(JSON.stringify({ total: 0, jobs: [] }), { status: 200 });
  };
  const api = siteApi("https://www.landthatrole.com", fetcher, "203.0.113.7");
  const { status } = await api.get("/api/v1/jobs", { q: "C++", country: undefined, limit: 5 });
  assert.equal(status, 200);
  assert.equal(seen.url, "https://www.landthatrole.com/api/v1/jobs?q=C%2B%2B&limit=5");
  assert.equal(seen.headers["X-Forwarded-For"], "203.0.113.7");
});

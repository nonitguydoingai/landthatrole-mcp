// Cloudflare Worker entry: the MCP endpoint at https://mcp.landthatrole.com/mcp.
// Stateless Streamable HTTP; serves 2026-07-28 clients and 2025-era clients alike.

import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildServer, siteApi } from "./server.ts";

interface Env {
  /** Base URL of the jobs API, e.g. https://www.landthatrole.com */
  SITE_URL: string;
  /** Service binding to the website's Worker: calls skip the public internet when present */
  SITE?: { fetch(input: string, init?: RequestInit): Promise<Response> };
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

const INFO = `LANDTHATROLE MCP server: search tech jobs in the US and Canada from AI apps.

Endpoint: https://mcp.landthatrole.com/mcp (Streamable HTTP, no login)
Tools: search_jobs, get_job, list_job_categories
How to connect: https://www.landthatrole.com/connect
Source: https://github.com/nonitguydoingai/landthatrole-mcp
`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/" || pathname === "/health") {
      return new Response(INFO, { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
    }
    if (pathname !== "/mcp") {
      return new Response(JSON.stringify({ error: "Not found. The MCP endpoint is /mcp." }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const clientIp = request.headers.get("cf-connecting-ip") ?? "";
    const fetcher = env.SITE ? (url: string, init?: RequestInit) => env.SITE!.fetch(url, init) : fetch;
    const api = siteApi(env.SITE_URL, fetcher as typeof fetch, clientIp);
    const handler = createMcpHandler(() => buildServer(api));
    return withCors(await handler.fetch(request));
  },
};

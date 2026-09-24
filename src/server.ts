// The LANDTHATROLE MCP server: three read-only tools over the public jobs API
// (https://www.landthatrole.com/api/v1, described at /openapi.json).

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

type Json = Record<string, unknown>;

/** Reads the public jobs API. Injected so tests can run without the network. */
export interface JobsApi {
  get(path: string, params?: Record<string, string | number | undefined>): Promise<{ status: number; body: Json }>;
}

/**
 * A JobsApi over fetch. `clientIp` is the MCP caller's IP, forwarded so the site's per-IP
 * rate limit applies to each person rather than to this server as a whole.
 */
export function siteApi(siteUrl: string, fetcher: typeof fetch, clientIp: string): JobsApi {
  return {
    async get(path, params = {}) {
      const url = new URL(path, siteUrl);
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
      const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "landthatrole-mcp/1.0" };
      if (clientIp) headers["X-Forwarded-For"] = clientIp;
      const res = await fetcher(url.toString(), { headers });
      const body = (await res.json().catch(() => ({ error: `The jobs API answered ${res.status}.` }))) as Json;
      return { status: res.status, body };
    },
  };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

interface Salary { min: number | null; max: number | null; currency: string; period: string }
interface Job {
  id: string; title: string; company: string; location: string | null; country: string | null;
  work_mode: string | null; salary: Salary | null; posted_at: string | null; url: string; apply_url: string | null;
  open?: boolean; description?: string; description_truncated?: boolean; employment_type?: string | null;
  experience_level?: string | null; skills?: string[]; source?: string | null;
}

function money(s: Salary | null): string {
  if (!s) return "salary not listed";
  const fmt = (n: number | null) => (n == null ? "" : n.toLocaleString("en-US"));
  const range = s.min && s.max && s.min !== s.max ? `${fmt(s.min)}–${fmt(s.max)}` : fmt(s.max ?? s.min);
  return `${s.currency} ${range} per ${s.period}`;
}

function jobLines(j: Job, n?: number): string {
  const head = `${n ? `${n}. ` : ""}${j.title} · ${j.company}`;
  const facts = [j.location ?? "location not listed", j.work_mode, money(j.salary), j.posted_at ? `posted ${j.posted_at.slice(0, 10)}` : null]
    .filter(Boolean)
    .join(" · ");
  const links = [`Job page: ${j.url}`, j.apply_url ? `Apply: ${j.apply_url}` : null, `id: ${j.id}`].filter(Boolean).join(" · ");
  return `${head}\n   ${facts}\n   ${links}`;
}

// API messages point at API paths; here the equivalent is a tool
const failed = (message: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: message.replace("/api/v1/categories", "the list_job_categories tool") }],
});

const JobSummary = z.looseObject({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  url: z.string(),
  apply_url: z.string().nullable(),
});

export function buildServer(api: JobsApi): McpServer {
  const server = new McpServer({ name: "landthatrole", title: "LANDTHATROLE Jobs", version: "1.0.0" });

  server.registerTool(
    "search_jobs",
    {
      title: "Search tech jobs",
      description:
        "Search open tech jobs in the United States and Canada, taken from employers' own hiring systems. " +
        "Returns the newest matches with title, company, location, work mode, salary when the employer lists it, " +
        "the job's page and the employer's apply link. Use list_job_categories for role slugs. " +
        "For more results, call again with offset set to next_offset.",
      inputSchema: z.object({
        query: z.string().max(100).optional().describe('Words in the job title or company, e.g. "react", "data engineer", "Shopify".'),
        role: z.string().max(60).optional().describe('A role slug from list_job_categories, e.g. "data-engineering" or "frontend-developer". Catches every common title for that role.'),
        country: z.enum(["US", "CA"]).optional().describe("US for the United States, CA for Canada."),
        city: z.string().max(60).optional().describe('City name, e.g. "Toronto" or "Austin".'),
        work_mode: z.array(z.enum(["remote", "hybrid", "onsite"])).max(3).optional().describe("Any of remote, hybrid, onsite."),
        salary_min: z.number().min(0).optional().describe("Lowest top-of-range salary, in the posting's currency (USD in the US, CAD in Canada), e.g. 120000. Only jobs that list a salary match."),
        posted_within_days: z.number().int().min(1).max(365).optional().describe("Only jobs posted in the last N days (rounded up to 1, 7 or 30)."),
        sort: z.enum(["recent", "salary"]).optional().describe("recent (default) or salary, highest first."),
        limit: z.number().int().min(1).max(25).optional().describe("How many jobs to return, 1 to 25. Default 10."),
        offset: z.number().int().min(0).max(10000).optional().describe("next_offset from the previous search, for the next page."),
      }),
      outputSchema: z.object({
        total: z.number(),
        next_offset: z.number().nullable(),
        jobs: z.array(JobSummary),
      }),
      annotations: READ_ONLY,
    },
    async (a) => {
      const { status, body } = await api.get("/api/v1/jobs", {
        q: a.query,
        role: a.role,
        country: a.country,
        city: a.city,
        work_mode: a.work_mode?.join(","),
        salary_min: a.salary_min,
        posted_within_days: a.posted_within_days,
        sort: a.sort,
        limit: a.limit ?? 10,
        offset: a.offset,
      });
      if (status !== 200) return failed(String(body.error ?? `The jobs API answered ${status}.`));
      const jobs = (body.jobs as Job[]) ?? [];
      const total = Number(body.total ?? 0);
      const offset = Number(body.offset ?? 0);
      const next = (body.next_offset as number | null) ?? null;
      const header = jobs.length
        ? `${total.toLocaleString("en-US")} open jobs match (showing ${offset + 1}–${offset + jobs.length}).` +
          (next != null ? ` For more, search again with offset ${next}.` : "")
        : "No open jobs match. Try fewer filters, a broader query, or a role slug from list_job_categories.";
      const text = [header, ...jobs.map((j, i) => jobLines(j, offset + i + 1))].join("\n\n");
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { total, next_offset: next, jobs },
      };
    }
  );

  server.registerTool(
    "get_job",
    {
      title: "Get a job's details",
      description:
        "Full details of one job from search_jobs: description, employment type, level, skills, salary, " +
        "and the employer's apply link. Says so when the employer has closed the posting.",
      inputSchema: z.object({
        id: z.string().min(1).max(200).describe("The id from a search_jobs result."),
      }),
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const { status, body } = await api.get(`/api/v1/jobs/${encodeURIComponent(id)}`);
      if (status !== 200) return failed(String(body.error ?? `The jobs API answered ${status}.`));
      const j = body as unknown as Job;
      const facts = [
        j.open === false ? "This posting has been closed by the employer." : null,
        j.employment_type ? `Employment type: ${j.employment_type}` : null,
        j.experience_level ? `Experience: ${j.experience_level}` : null,
        j.skills?.length ? `Skills named: ${j.skills.join(", ")}` : null,
        j.source ? `Posted through: ${j.source}` : null,
      ].filter(Boolean);
      const description = (j.description ?? "").slice(0, 8000);
      const cut = j.description_truncated || (j.description ?? "").length > description.length;
      const text = [jobLines(j), ...facts, "", description + (cut ? `\n[Description shortened. Full posting: ${j.url}]` : "")].join("\n");
      return { content: [{ type: "text" as const, text }], structuredContent: body };
    }
  );

  server.registerTool(
    "list_job_categories",
    {
      title: "List role categories and locations",
      description:
        "The role slugs search_jobs accepts (39 fields such as software-engineering, ai-machine-learning, " +
        "cybersecurity, hardware-semiconductors, plus single roles such as frontend-developer) and the cities and " +
        "regions with their own job pages.",
      annotations: READ_ONLY,
    },
    async () => {
      const { status, body } = await api.get("/api/v1/categories");
      if (status !== 200) return failed(String(body.error ?? `The jobs API answered ${status}.`));
      const groups = (body.role_groups as { slug: string; name: string; covers: string }[]) ?? [];
      const roles = (body.roles as { slug: string; name: string }[]) ?? [];
      const places = (body.locations as { name: string; kind: string; country: string | null }[]) ?? [];
      const text = [
        "Role fields (use the slug as role):",
        ...groups.map((g) => `- ${g.slug}: ${g.name} (${g.covers})`),
        "",
        "Single roles:",
        ...roles.map((r) => `- ${r.slug}: ${r.name}`),
        "",
        "Locations with their own pages (pass the name as city, or use country):",
        places.map((p) => p.name).join(", "),
      ].join("\n");
      return { content: [{ type: "text" as const, text }], structuredContent: body };
    }
  );

  return server;
}

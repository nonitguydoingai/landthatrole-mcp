# LANDTHATROLE Jobs: MCP server

Search open tech jobs in the United States and Canada from Claude, ChatGPT, Cursor, VS Code and any other app that supports the [Model Context Protocol](https://modelcontextprotocol.io). The jobs come from employers' own hiring systems (Greenhouse, Lever, Workday, Ashby, Oracle and others) and are refreshed several times a day by [LANDTHATROLE](https://www.landthatrole.com).

**Endpoint:** `https://mcp.landthatrole.com/mcp` (Streamable HTTP, no login, read-only)

## Tools

| Tool | What it does |
|---|---|
| `search_jobs` | Search by words in the title or company, role, country (US or CA), city, work mode (remote, hybrid, onsite), minimum salary, and how recently the job was posted. Returns up to 25 jobs per call, each with the job's page and the employer's apply link. |
| `get_job` | One job's full description, employment type, level and skills. Says when the employer has closed it. |
| `list_job_categories` | The role slugs `search_jobs` accepts (39 tech fields plus single roles such as `frontend-developer`) and the cities with their own pages. |

Every tool is read-only: it never changes anything and needs no account.

## Connect

**Claude** (web, desktop, mobile): Settings → Connectors → Add custom connector, and paste `https://mcp.landthatrole.com/mcp`.

**Claude Code:**

```sh
claude mcp add --transport http landthatrole https://mcp.landthatrole.com/mcp
```

**ChatGPT** (Pro, Business, Enterprise and Edu, in developer mode): Settings → Apps → Create, and paste the same URL.

**Cursor**, in `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "landthatrole": { "url": "https://mcp.landthatrole.com/mcp" } } }
```

**VS Code**, in `.vscode/mcp.json`:

```json
{ "servers": { "landthatrole": { "type": "http", "url": "https://mcp.landthatrole.com/mcp" } } }
```

Step-by-step instructions for more apps: <https://www.landthatrole.com/connect>

## Try asking

- "Find remote React jobs in Canada posted this week."
- "Which companies are hiring data engineers in Austin? Show salaries where listed."
- "Show me the full description of the second job."

## REST API

The server is a thin layer over a public REST API you can call directly: `GET https://www.landthatrole.com/api/v1/jobs?q=react&country=CA`. It's described in OpenAPI at <https://www.landthatrole.com/openapi.json>.

## Run your own copy

```sh
npm install
npm test
npx wrangler deploy   # Cloudflare Workers
```

`wrangler.toml` points `SITE_URL` at the public API, so a fork works without the service binding (remove the `[[services]]` block). The server is stateless and needs no database, keys or Durable Objects.

## Limits and data

- About 60 requests a minute per person. Results are cached for about a minute.
- Job descriptions belong to the employers. Link to the job's page or the apply link when you show a job.
- Privacy policy: <https://www.landthatrole.com/privacy>. Terms: <https://www.landthatrole.com/terms>.
- Questions or problems: <https://www.landthatrole.com/contact>

MIT licensed.

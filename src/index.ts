import express, { Request, Response } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ─── API clients ────────────────────────────────────────────────────────────

const API_KEY = process.env.SEARCHATLAS_API_KEY ?? "";

const BASES = {
  keyword: "https://keyword.searchatlas.com/api",
  otto: "https://sa.searchatlas.com/api/v2",
  cg: "https://ca.searchatlas.com/api/cg/v1",
  main: "https://api.searchatlas.com/api",
} as const;

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function call(
  base: keyof typeof BASES,
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
  queryParams?: Record<string, string | number | boolean>
): Promise<unknown> {
  const url = new URL(`${BASES[base]}${path}`);

  // The keyword API uses query-param auth; otto/cg use header auth
  if (base === "keyword") {
    url.searchParams.set("searchatlas_api_key", API_KEY);
  }
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (base !== "keyword") {
    headers["x-api-key"] = API_KEY;
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Search Atlas API error ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ─── MCP server factory ──────────────────────────────────────────────────────

function buildServer(): McpServer {
  const server = new McpServer({
    name: "searchatlas-mcp",
    version: "1.0.0",
  });

  // ── Rank Tracker ─────────────────────────────────────────────────────────

  server.tool(
    "rank_tracker_list_projects",
    "List all keyword rank tracking projects.",
    {},
    async () => {
      const data = await call("keyword", "/v1/rank-tracker/");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "rank_tracker_get_keywords",
    "Get keyword rankings for a rank tracker project.",
    {
      project_id: z.string().describe("Rank tracker project ID"),
      period: z.enum(["7d", "30d", "90d"]).optional().describe("Lookback period"),
      location: z.string().optional().describe("Filter by location"),
    },
    async ({ project_id, period, location }) => {
      const params: Record<string, string> = {};
      if (period) params.period = period;
      if (location) params.location = location;
      const data = await call("keyword", `/v1/rank-tracker/${project_id}/keywords-details/`, "GET", undefined, params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "rank_tracker_add_keywords",
    "Add keywords to an existing rank tracker project.",
    {
      project_id: z.string().describe("Rank tracker project ID"),
      keywords: z.array(z.string()).describe("Keywords to track"),
    },
    async ({ project_id, keywords }) => {
      const data = await call("keyword", `/v2/rank-tracker/${project_id}/tracked-keywords/`, "PUT", { keywords });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "rank_tracker_remove_keywords",
    "Remove keywords from a rank tracker project.",
    {
      project_id: z.string().describe("Rank tracker project ID"),
      keywords: z.array(z.string()).describe("Keywords to remove"),
    },
    async ({ project_id, keywords }) => {
      const data = await call("keyword", `/v2/rank-tracker/${project_id}/tracked-keywords/`, "DELETE", { keywords });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "rank_tracker_get_competitors",
    "Get competitor visibility scores for a rank tracker project.",
    {
      project_id: z.string().describe("Rank tracker project ID"),
    },
    async ({ project_id }) => {
      const data = await call("keyword", `/v1/rank-tracker/${project_id}/competitors-by-visibility/`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "rank_tracker_keyword_history",
    "Get historical ranking data for a specific keyword in a project.",
    {
      project_id: z.string().describe("Rank tracker project ID"),
      keyword: z.string().describe("The keyword to get history for"),
    },
    async ({ project_id, keyword }) => {
      const data = await call("keyword", `/v2/rank-tracker/${project_id}/keyword-historical-performance/`, "GET", undefined, { keyword });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "rank_tracker_refresh",
    "Force a SERP data refresh for a rank tracker project.",
    {
      project_id: z.string().describe("Rank tracker project ID"),
    },
    async ({ project_id }) => {
      const data = await call("keyword", `/v1/rank-tracker/${project_id}/refresh/`, "POST");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "rank_tracker_create_project",
    "Create a new keyword rank tracker project.",
    {
      name: z.string().describe("Project name"),
      domain: z.string().describe("Domain to track (e.g. example.com)"),
      location: z.string().optional().describe("Target location for rankings"),
    },
    async ({ name, domain, location }) => {
      const body: Record<string, unknown> = { name, domain };
      if (location) body.location = location;
      const data = await call("keyword", "/v1/rank-tracker/", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── OTTO SEO ──────────────────────────────────────────────────────────────

  server.tool(
    "otto_list_projects",
    "List all OTTO SEO projects.",
    {
      search: z.string().optional().describe("Filter projects by name"),
      page: z.number().optional().describe("Page number for pagination"),
    },
    async ({ search, page }) => {
      const params: Record<string, string | number> = {};
      if (search) params.search = search;
      if (page) params.page = page;
      const data = await call("otto", "/otto-projects/", "GET", undefined, params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "otto_get_project",
    "Get details of a specific OTTO SEO project.",
    {
      otto_uuid: z.string().describe("OTTO project UUID"),
    },
    async ({ otto_uuid }) => {
      const data = await call("otto", `/otto-projects/${otto_uuid}/`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "otto_create_site_audit",
    "Create a site audit crawl. Returns an audit ID you can use to create an OTTO project.",
    {
      url: z.string().url().describe("The site URL to audit"),
    },
    async ({ url }) => {
      const data = await call("otto", "/site-audit/", "POST", { url });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "otto_create_project",
    "Create an OTTO SEO project from a site audit ID.",
    {
      site_audit_id: z.number().describe("Site audit ID returned from otto_create_site_audit"),
      name: z.string().optional().describe("Project name"),
    },
    async ({ site_audit_id, name }) => {
      const body: Record<string, unknown> = { site_audit: site_audit_id };
      if (name) body.name = name;
      const data = await call("otto", "/otto-projects/", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Press Releases ───────────────────────────────────────────────────────

  server.tool(
    "press_release_list",
    "List press releases, optionally filtered by status or OTTO project.",
    {
      status: z.enum(["draft", "pending", "published"]).optional().describe("Filter by status"),
      page: z.number().optional().describe("Page number"),
    },
    async ({ status, page }) => {
      const params: Record<string, string | number> = {};
      if (status) params.status = status;
      if (page) params.page = page;
      const data = await call("cg", "/press-release/", "GET", undefined, params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "press_release_get",
    "Get details of a specific press release.",
    {
      id: z.number().describe("Press release ID"),
    },
    async ({ id }) => {
      const data = await call("cg", `/press-release/${id}/`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "press_release_create",
    "Create a new press release.",
    {
      target_url: z.string().url().describe("URL to link to from the press release"),
      target_keywords: z.array(z.string()).describe("Keywords to target"),
      input_prompt: z.string().describe("Prompt or brief for the AI to generate the press release content"),
    },
    async ({ target_url, target_keywords, input_prompt }) => {
      const data = await call("cg", "/press-release/", "POST", {
        target_url,
        target_keywords,
        input_prompt,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "press_release_build",
    "Trigger AI content generation for a press release. Returns a task ID to poll for completion.",
    {
      id: z.number().describe("Press release ID"),
    },
    async ({ id }) => {
      const data = await call("cg", `/press-release/${id}/build/`, "POST");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "press_release_deploy",
    "Distribute a press release to press outlets.",
    {
      id: z.number().describe("Press release ID"),
    },
    async ({ id }) => {
      const data = await call("cg", `/press-release/${id}/deploy/signal-genesys/`, "POST");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "press_release_check_worthiness",
    "Score a headline or summary for newsworthiness before creating a press release.",
    {
      headline: z.string().describe("The press release headline to evaluate"),
      summary: z.string().optional().describe("Optional summary to evaluate alongside the headline"),
    },
    async ({ headline, summary }) => {
      const body: Record<string, string> = { headline };
      if (summary) body.summary = summary;
      const data = await call("cg", "/press-release/check-worthiness/", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Local SEO / GBP ──────────────────────────────────────────────────────

  server.tool(
    "local_seo_search_business",
    "Search for businesses by name and/or location coordinates.",
    {
      query: z.string().describe("Business name or search query"),
      lat: z.number().optional().describe("Latitude"),
      lng: z.number().optional().describe("Longitude"),
    },
    async ({ query, lat, lng }) => {
      const params: Record<string, string | number> = { query };
      if (lat !== undefined) params.lat = lat;
      if (lng !== undefined) params.lng = lng;
      const data = await call("keyword", "/v3/google-business/text-search/", "GET", undefined, params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "local_seo_get_place_details",
    "Get detailed information about a Google Business Profile place.",
    {
      place_id: z.string().describe("Google place ID"),
    },
    async ({ place_id }) => {
      const data = await call("keyword", "/v3/google-business/place-detail/", "GET", undefined, { place_id });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "local_seo_add_business",
    "Add a Google Business Profile location to Search Atlas.",
    {
      name: z.string().describe("Business name"),
      lat: z.number().optional().describe("Latitude"),
      lng: z.number().optional().describe("Longitude"),
      gbp_url: z.string().optional().describe("Google Business Profile URL"),
    },
    async ({ name, lat, lng, gbp_url }) => {
      const body: Record<string, unknown> = { name };
      if (lat !== undefined) body.lat = lat;
      if (lng !== undefined) body.lng = lng;
      if (gbp_url) body.gbp_url = gbp_url;
      const data = await call("keyword", "/v3/google-business/", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "local_seo_setup_grid",
    "Configure a local SEO ranking grid for a business.",
    {
      business_id: z.string().describe("Business ID from local_seo_add_business"),
      keyword: z.string().describe("Keyword to track on the grid"),
      grid_size: z.number().describe("Grid size (e.g. 5 for a 5x5 grid)"),
      spacing_km: z.number().describe("Distance between grid points in km"),
      frequency: z.enum(["daily", "weekly", "monthly"]).describe("Update frequency"),
    },
    async ({ business_id, keyword, grid_size, spacing_km, frequency }) => {
      const data = await call("keyword", `/v3/google-business/${business_id}/setup-grids/`, "POST", {
        keyword,
        grid_size,
        spacing_km,
        frequency,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Google Search Console ────────────────────────────────────────────────

  server.tool(
    "gsc_get_sites",
    "List all Google Search Console sites connected to Search Atlas.",
    {},
    async () => {
      const data = await call("otto", "/gsc/sites/");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gsc_get_performance",
    "Get Google Search Console search performance data (clicks, impressions, CTR, position).",
    {
      site_url: z.string().describe("Site URL as registered in GSC (e.g. https://example.com/)"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().describe("End date in YYYY-MM-DD format"),
      dimensions: z.array(z.enum(["query", "page", "country", "device", "date"])).optional().describe("Dimensions to group results by"),
      row_limit: z.number().optional().describe("Maximum number of rows to return (default 25, max 1000)"),
    },
    async ({ site_url, start_date, end_date, dimensions, row_limit }) => {
      const body: Record<string, unknown> = { site_url, start_date, end_date };
      if (dimensions) body.dimensions = dimensions;
      if (row_limit) body.row_limit = row_limit;
      const data = await call("otto", "/gsc/performance/", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gsc_get_index_coverage",
    "Get Google Search Console index coverage report for a site.",
    {
      site_url: z.string().describe("Site URL as registered in GSC"),
    },
    async ({ site_url }) => {
      const data = await call("otto", "/gsc/index-coverage/", "GET", undefined, { site_url });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gsc_get_sitemaps",
    "List sitemaps submitted to Google Search Console for a site.",
    {
      site_url: z.string().describe("Site URL as registered in GSC"),
    },
    async ({ site_url }) => {
      const data = await call("otto", "/gsc/sitemaps/", "GET", undefined, { site_url });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Google Analytics ──────────────────────────────────────────────────────

  server.tool(
    "ga_get_properties",
    "List all Google Analytics 4 properties connected to Search Atlas.",
    {},
    async () => {
      const data = await call("otto", "/ga/properties/");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "ga_get_traffic",
    "Get Google Analytics traffic overview (sessions, users, pageviews, bounce rate).",
    {
      property_id: z.string().describe("GA4 property ID"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().describe("End date in YYYY-MM-DD format"),
      metrics: z.array(z.string()).optional().describe("Metrics to retrieve (e.g. sessions, activeUsers, screenPageViews)"),
    },
    async ({ property_id, start_date, end_date, metrics }) => {
      const body: Record<string, unknown> = { property_id, start_date, end_date };
      if (metrics) body.metrics = metrics;
      const data = await call("otto", "/ga/traffic/", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "ga_get_top_pages",
    "Get top performing pages from Google Analytics by sessions or pageviews.",
    {
      property_id: z.string().describe("GA4 property ID"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().describe("End date in YYYY-MM-DD format"),
      limit: z.number().optional().describe("Number of top pages to return (default 10)"),
    },
    async ({ property_id, start_date, end_date, limit }) => {
      const body: Record<string, unknown> = { property_id, start_date, end_date };
      if (limit) body.limit = limit;
      const data = await call("otto", "/ga/top-pages/", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "ga_get_conversions",
    "Get conversion and goal data from Google Analytics.",
    {
      property_id: z.string().describe("GA4 property ID"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().describe("End date in YYYY-MM-DD format"),
    },
    async ({ property_id, start_date, end_date }) => {
      const data = await call("otto", "/ga/conversions/", "POST", { property_id, start_date, end_date });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Google Business Profile (extended) ────────────────────────────────────

  server.tool(
    "gbp_get_reviews",
    "Get reviews for a Google Business Profile location.",
    {
      business_id: z.string().describe("Business ID from local_seo_add_business"),
      page: z.number().optional().describe("Page number for pagination"),
    },
    async ({ business_id, page }) => {
      const params: Record<string, number> = {};
      if (page) params.page = page;
      const data = await call("keyword", `/v3/google-business/${business_id}/reviews/`, "GET", undefined, params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gbp_reply_to_review",
    "Post or update a reply to a Google Business Profile review.",
    {
      business_id: z.string().describe("Business ID"),
      review_id: z.string().describe("Review ID to reply to"),
      reply: z.string().describe("Reply text"),
    },
    async ({ business_id, review_id, reply }) => {
      const data = await call("keyword", `/v3/google-business/${business_id}/reviews/${review_id}/reply/`, "POST", { reply });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gbp_get_insights",
    "Get insights for a Google Business Profile (views, searches, direction requests, calls).",
    {
      business_id: z.string().describe("Business ID"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().describe("End date in YYYY-MM-DD format"),
    },
    async ({ business_id, start_date, end_date }) => {
      const data = await call("keyword", `/v3/google-business/${business_id}/insights/`, "GET", undefined, { start_date, end_date });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gbp_create_post",
    "Create a Google Business Profile post (update, offer, or event).",
    {
      business_id: z.string().describe("Business ID"),
      post_type: z.enum(["update", "offer", "event"]).describe("Type of GBP post"),
      summary: z.string().describe("Post body text"),
      call_to_action_type: z.enum(["LEARN_MORE", "BOOK", "ORDER", "SHOP", "SIGN_UP", "CALL"]).optional().describe("Call-to-action button type"),
      call_to_action_url: z.string().url().optional().describe("URL for the call-to-action button"),
    },
    async ({ business_id, post_type, summary, call_to_action_type, call_to_action_url }) => {
      const body: Record<string, unknown> = { post_type, summary };
      if (call_to_action_type) body.call_to_action_type = call_to_action_type;
      if (call_to_action_url) body.call_to_action_url = call_to_action_url;
      const data = await call("keyword", `/v3/google-business/${business_id}/posts/`, "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Heatmaps ──────────────────────────────────────────────────────────────

  server.tool(
    "heatmap_list",
    "List all heatmap projects in Search Atlas.",
    {
      page: z.number().optional().describe("Page number for pagination"),
    },
    async ({ page }) => {
      const params: Record<string, number> = {};
      if (page) params.page = page;
      const data = await call("main", "/heatmaps/", "GET", undefined, params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "heatmap_get",
    "Get heatmap data for a specific heatmap project.",
    {
      heatmap_id: z.string().describe("Heatmap project ID"),
    },
    async ({ heatmap_id }) => {
      const data = await call("main", `/heatmaps/${heatmap_id}/`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "heatmap_create",
    "Create a new heatmap tracking project for a URL.",
    {
      url: z.string().url().describe("URL to track with heatmap"),
      name: z.string().optional().describe("Project name"),
      device: z.enum(["desktop", "mobile", "tablet"]).optional().describe("Device type to track (default: desktop)"),
    },
    async ({ url, name, device }) => {
      const body: Record<string, unknown> = { url };
      if (name) body.name = name;
      if (device) body.device = device;
      const data = await call("main", "/heatmaps/", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "heatmap_get_snapshots",
    "Get recorded click/scroll/move snapshots for a heatmap project.",
    {
      heatmap_id: z.string().describe("Heatmap project ID"),
      type: z.enum(["click", "scroll", "move"]).optional().describe("Type of heatmap data to retrieve"),
      start_date: z.string().optional().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().optional().describe("End date in YYYY-MM-DD format"),
    },
    async ({ heatmap_id, type, start_date, end_date }) => {
      const params: Record<string, string> = {};
      if (type) params.type = type;
      if (start_date) params.start_date = start_date;
      if (end_date) params.end_date = end_date;
      const data = await call("main", `/heatmaps/${heatmap_id}/snapshots/`, "GET", undefined, params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Cloud Stacks ─────────────────────────────────────────────────────────

  server.tool(
    "cloud_stack_list",
    "List all Cloud Stack SEO content items.",
    {
      page: z.number().optional().describe("Page number"),
    },
    async ({ page }) => {
      const params: Record<string, number> = {};
      if (page) params.page = page;
      const data = await call("cg", "/cloud-stack-contents", "GET", undefined, params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "cloud_stack_get",
    "Get details of a specific Cloud Stack item.",
    {
      id: z.number().describe("Cloud Stack item ID"),
    },
    async ({ id }) => {
      const data = await call("cg", `/cloud-stack-contents/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "cloud_stack_create",
    "Create a Cloud Stack SEO content item (costs 15 Hyperdrive credits at generation).",
    {
      otto_project_uuid: z.string().optional().describe("OTTO project UUID to link to"),
      target_url: z.string().url().describe("Target URL to build authority for"),
      target_keywords: z.array(z.string()).describe("Keywords to target"),
    },
    async ({ otto_project_uuid, target_url, target_keywords }) => {
      const body: Record<string, unknown> = { target_url, target_keywords };
      if (otto_project_uuid) body.otto_project = otto_project_uuid;
      const data = await call("cg", "/cloud-stack-contents/", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "cloud_stack_build",
    "Trigger AI content generation for a Cloud Stack item.",
    {
      id: z.number().describe("Cloud Stack item ID"),
    },
    async ({ id }) => {
      const data = await call("cg", `/cloud-stack-contents/${id}/build/`, "POST");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "cloud_stack_deploy",
    "Deploy a generated Cloud Stack item to hosting providers.",
    {
      id: z.number().describe("Cloud Stack item ID"),
    },
    async ({ id }) => {
      const data = await call("cg", `/cloud-stack-contents/${id}/deploy/`, "POST");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "cloud_stack_list_providers",
    "List available hosting providers for Cloud Stack deployment.",
    {},
    async () => {
      const data = await call("cg", "/cloud-stack-providers");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}

// ─── Express HTTP server ─────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// Optional: protect the endpoint with a bearer token
function isAuthorized(req: Request): boolean {
  const secret = process.env.MCP_AUTH_TOKEN;
  if (!secret) return true; // no auth configured — open
  const auth = req.headers.authorization ?? "";
  return auth === `Bearer ${secret}`;
}

app.all("/mcp", async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session tracking needed
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "searchatlas-mcp" });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Search Atlas MCP server listening on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});

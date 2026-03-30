/**
 * Semantic Layer API client.
 *
 * Uses direct fetch against /api/semantic/* endpoints.
 * Once the OpenAPI client is regenerated, these can be replaced
 * with typed api-client calls.
 */

function getApiBase(): string {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_API_URL ?? "/api";
  }
  return (
    process.env.INTERNAL_API_URL ??
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8000"
  );
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────

export interface GlossaryTerm {
  id: string;
  displayName: string;
  description: string | null;
  category: string | null;
  filterMapping: Record<string, string[]>;
  color: string | null;
  icon: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  metrics?: MetricDefinition[];
  findingCount?: number;
}

export interface MetricDefinition {
  id: string;
  displayName: string;
  description: string | null;
  type: "SIMPLE" | "RATIO" | "DERIVED" | "TREND";
  status: "DRAFT" | "ACTIVE" | "DEPRECATED";
  definition: Record<string, unknown>;
  allowedDimensions: string[];
  glossaryTermId: string | null;
  format: string | null;
  unit: string | null;
  color: string | null;
  owner: string | null;
  certifiedAt: string | null;
  certifiedBy: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  currentValue?: number | null;
  glossaryTerm?: { id: string; displayName: string } | null;
}

export interface MetricResult {
  metricId: string;
  value: number | null;
  breakdown?: { dimensionValue: string; value: number }[];
}

export interface DashboardMetricResult {
  metricId: string;
  displayName: string;
  value: number | null;
  format: string | null;
  unit: string | null;
  color: string | null;
  size: string;
  position: number;
  chartType: string | null;
}

// ── Glossary API ───────────────────────────────────────────────

export const semanticApi = {
  glossary: {
    list(params?: { category?: string }) {
      const qs = params?.category ? `?category=${params.category}` : "";
      return fetchJson<{ items: GlossaryTerm[]; total: number }>(
        `/semantic/glossary${qs}`,
      );
    },
    get(id: string) {
      return fetchJson<GlossaryTerm>(`/semantic/glossary/${id}`);
    },
    create(data: Partial<GlossaryTerm>) {
      return fetchJson<GlossaryTerm>("/semantic/glossary", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    update(id: string, data: Partial<GlossaryTerm>) {
      return fetchJson<GlossaryTerm>(`/semantic/glossary/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    delete(id: string) {
      return fetchJson(`/semantic/glossary/${id}`, { method: "DELETE" });
    },
    preview(id: string) {
      return fetchJson<{ id: string; findingCount: number }>(
        `/semantic/glossary/${id}/preview`,
        { method: "POST", body: "{}" },
      );
    },
  },

  metrics: {
    list(params?: { type?: string; status?: string }) {
      const qs = new URLSearchParams();
      if (params?.type) qs.set("type", params.type);
      if (params?.status) qs.set("status", params.status);
      const qsStr = qs.toString() ? `?${qs.toString()}` : "";
      return fetchJson<{ items: MetricDefinition[]; total: number }>(
        `/semantic/metrics${qsStr}`,
      );
    },
    get(id: string) {
      return fetchJson<MetricDefinition>(`/semantic/metrics/${id}`);
    },
    create(data: Record<string, unknown>) {
      return fetchJson<MetricDefinition>("/semantic/metrics", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    update(id: string, data: Record<string, unknown>) {
      return fetchJson<MetricDefinition>(`/semantic/metrics/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    delete(id: string) {
      return fetchJson(`/semantic/metrics/${id}`, { method: "DELETE" });
    },
    certify(id: string, certifiedBy: string) {
      return fetchJson<MetricDefinition>(
        `/semantic/metrics/${id}/certify`,
        {
          method: "POST",
          body: JSON.stringify({ certifiedBy }),
        },
      );
    },
  },

  query: {
    evaluate(data: {
      metricId: string;
      dimensions?: string[];
      filters?: Record<string, unknown>;
      from?: string;
      to?: string;
      glossaryTermId?: string;
    }) {
      return fetchJson<MetricResult>("/semantic/query", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    timeseries(data: {
      metricId: string;
      granularity: "hour" | "day" | "week" | "month";
      from?: string;
      to?: string;
      glossaryTermId?: string;
    }) {
      return fetchJson<{
        metricId: string;
        timeSeries: { timestamp: string; value: number }[];
      }>("/semantic/query/timeseries", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    dashboard(data: {
      dashboard: string;
      filters?: Record<string, unknown>;
      from?: string;
      to?: string;
    }) {
      return fetchJson<{
        dashboard: string;
        metrics: DashboardMetricResult[];
      }>("/semantic/query/dashboard", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    explore(data: {
      glossaryTermId: string;
      metricIds: string[];
      dimensions?: string[];
      from?: string;
      to?: string;
    }) {
      return fetchJson<{
        glossaryTermId: string;
        results: MetricResult[];
      }>("/semantic/query/explore", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
  },
};

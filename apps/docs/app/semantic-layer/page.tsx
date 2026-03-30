import type { Metadata } from "next";

import { Badge, Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components";
import {
  mockGlossaryTerms,
  mockMetricDefinitions,
  mockMetricResults,
} from "@workspace/ui/mocks";

import { NextraPageShell } from "@/components/nextra-page-shell";

export const metadata: Metadata = {
  title: "Semantic Layer",
  description:
    "Business-friendly abstraction that translates raw detection data into governed concepts, metrics, and dimensions.",
};

const typeBadgeColor: Record<string, string> = {
  SIMPLE: "border-blue-500/40 text-blue-600 dark:text-blue-400",
  RATIO: "border-purple-500/40 text-purple-600 dark:text-purple-400",
  DERIVED: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  TREND: "border-green-500/40 text-green-600 dark:text-green-400",
};

const statusBadgeColor: Record<string, string> = {
  DRAFT: "border-gray-500/40 text-gray-600 dark:text-gray-400",
  ACTIVE: "border-green-500/40 text-green-600 dark:text-green-400",
  DEPRECATED: "border-red-500/40 text-red-600 dark:text-red-400",
};

function formatMetricValue(value: number | null, format: string): string {
  if (value === null) return "\u2014";
  if (format === "percentage") return `${(value * 100).toFixed(1)}%`;
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(2);
}

const tocItems = [
  { id: "overview", value: "Overview" },
  { id: "what-is-a-semantic-layer", value: "What Is a Semantic Layer?" },
  { id: "business-glossary", value: "Business Glossary" },
  { id: "governed-metrics", value: "Governed Metrics" },
  { id: "metric-types", value: "Metric Types" },
  { id: "live-metric-values", value: "Live Metric Values" },
  { id: "dimension-breakdowns", value: "Dimension Breakdowns" },
  { id: "getting-started", value: "Getting Started" },
];

export default function SemanticLayerDocsPage() {
  const activeTerms = mockGlossaryTerms.filter((t) => t.isActive);
  const activeMetrics = mockMetricDefinitions.filter((m) => m.status === "ACTIVE");
  const totalFindings = mockGlossaryTerms.reduce((sum, t) => sum + t.findingCount, 0);

  return (
    <NextraPageShell
      title="Semantic Layer"
      filePath="app/semantic-layer/page.tsx"
      toc={tocItems}
    >
      <div className="space-y-10">
        {/* Header */}
        <header id="overview" className="scroll-mt-24 space-y-4">
          <Badge
            variant="secondary"
            className="rounded-[4px] border-2 border-border bg-accent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-accent-foreground"
          >
            Semantic Layer
          </Badge>
          <h1 className="font-serif text-4xl font-black uppercase tracking-[0.08em] text-foreground sm:text-5xl">
            Semantic Layer
          </h1>
          <p className="max-w-3xl text-lg text-muted-foreground">
            The Semantic Layer translates raw detection data into business-friendly concepts. It
            provides a single source of truth for metric definitions, ensuring everyone from
            security engineers to compliance officers sees the same numbers.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{activeTerms.length} glossary terms</Badge>
            <Badge variant="outline">{activeMetrics.length} active metrics</Badge>
            <Badge variant="outline">{totalFindings.toLocaleString()} mapped findings</Badge>
          </div>
        </header>

        {/* What Is */}
        <section id="what-is-a-semantic-layer" className="scroll-mt-24 space-y-4">
          <h2 className="font-serif text-2xl font-black uppercase tracking-[0.08em]">
            What Is a Semantic Layer?
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="border-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold">Business Glossary</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Maps business terms like &ldquo;Security Threats&rdquo; or &ldquo;PII Exposure&rdquo; to technical
                detector types and filter configurations. Non-technical stakeholders use familiar
                language while the system translates to precise queries.
              </CardContent>
            </Card>
            <Card className="border-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold">Governed Metrics</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Metrics are defined once and calculated consistently everywhere&mdash;dashboards,
                APIs, MCP tools, and reports. No more ad-hoc calculations that drift between teams.
              </CardContent>
            </Card>
            <Card className="border-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold">Dimensions</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Standardized slicing axes (severity, detector type, status, category) let users
                drill into any metric. Dimension access is governed per metric definition.
              </CardContent>
            </Card>
          </div>

          <div className="rounded-lg border-2 border-dashed border-muted-foreground/20 bg-muted/30 p-6">
            <p className="text-center text-sm text-muted-foreground">
              <span className="font-mono text-xs">Raw Finding Data</span>
              <span className="mx-3">&rarr;</span>
              <span className="font-mono text-xs">Glossary Filter</span>
              <span className="mx-3">&rarr;</span>
              <span className="font-mono text-xs">Metric Engine</span>
              <span className="mx-3">&rarr;</span>
              <span className="font-bold text-foreground">Business Value</span>
            </p>
          </div>
        </section>

        {/* Business Glossary */}
        <section id="business-glossary" className="scroll-mt-24 space-y-4">
          <h2 className="font-serif text-2xl font-black uppercase tracking-[0.08em]">
            Business Glossary
          </h2>
          <p className="text-muted-foreground">
            Each glossary term maps a business concept to a set of technical filters. When a user
            queries &ldquo;Security Threats,&rdquo; the system translates that into detector types like{" "}
            <code className="font-mono text-xs">SECRETS</code>,{" "}
            <code className="font-mono text-xs">YARA</code>, and{" "}
            <code className="font-mono text-xs">PROMPT_INJECTION</code>.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeTerms.map((term) => (
              <Card key={term.slug} className="border-2 transition-colors hover:border-accent">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-sm font-bold">{term.displayName}</CardTitle>
                    <Badge variant="outline" className="text-[10px]">
                      {term.category}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {term.description}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(term.filterMapping).map(([key, values]) =>
                      values.map((v) => (
                        <Badge
                          key={`${key}-${v}`}
                          variant="secondary"
                          className="text-[10px]"
                        >
                          {v}
                        </Badge>
                      )),
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{term.findingCount.toLocaleString()} findings</span>
                    <span>&middot;</span>
                    <span>{term.metricCount} metrics</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Governed Metrics */}
        <section id="governed-metrics" className="scroll-mt-24 space-y-4">
          <h2 className="font-serif text-2xl font-black uppercase tracking-[0.08em]">
            Governed Metrics
          </h2>
          <p className="text-muted-foreground">
            Every metric has a single, versioned definition with governance metadata: who owns it,
            whether it&rsquo;s certified, and which dimensions it supports.
          </p>

          <div className="space-y-2">
            {mockMetricDefinitions.map((metric) => (
              <Card key={metric.slug} className="border-2">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{metric.displayName}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${typeBadgeColor[metric.type] ?? ""}`}
                      >
                        {metric.type}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${statusBadgeColor[metric.status] ?? ""}`}
                      >
                        {metric.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {metric.description}
                    </p>
                    {metric.allowedDimensions.length > 0 && (
                      <div className="flex gap-1">
                        {metric.allowedDimensions.map((dim) => (
                          <Badge key={dim} variant="secondary" className="text-[10px]">
                            {dim}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xl font-bold">
                      {formatMetricValue(metric.currentValue, metric.format)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{metric.unit}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Metric Types */}
        <section id="metric-types" className="scroll-mt-24 space-y-4">
          <h2 className="font-serif text-2xl font-black uppercase tracking-[0.08em]">
            Metric Types
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="border-2 border-blue-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  <Badge variant="outline" className="mr-2 text-[10px] border-blue-500/40 text-blue-600 dark:text-blue-400">SIMPLE</Badge>
                  Simple Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Single aggregation over an entity. Supports COUNT, COUNT_DISTINCT, SUM, AVG, MIN, MAX.</p>
                <pre className="rounded bg-muted p-2 text-xs font-mono overflow-auto">
{`{
  "aggregation": "COUNT",
  "entity": "finding",
  "filters": { "statuses": ["OPEN"] }
}`}
                </pre>
              </CardContent>
            </Card>

            <Card className="border-2 border-purple-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  <Badge variant="outline" className="mr-2 text-[10px] border-purple-500/40 text-purple-600 dark:text-purple-400">RATIO</Badge>
                  Ratio Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Divides a numerator by a denominator. Each side can be an inline definition or reference another metric.</p>
                <pre className="rounded bg-muted p-2 text-xs font-mono overflow-auto">
{`{
  "numerator": {
    "aggregation": "COUNT",
    "filters": { "statuses": ["FALSE_POSITIVE"] }
  },
  "denominator": {
    "aggregation": "COUNT",
    "entity": "finding"
  }
}`}
                </pre>
              </CardContent>
            </Card>

            <Card className="border-2 border-amber-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  <Badge variant="outline" className="mr-2 text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">DERIVED</Badge>
                  Derived Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Arithmetic formula combining other metric values. Input metrics are evaluated first, then the formula is computed.</p>
                <pre className="rounded bg-muted p-2 text-xs font-mono overflow-auto">
{`{
  "formula": "open_findings * 100 / total_findings",
  "inputs": ["open-findings", "total-findings"]
}`}
                </pre>
              </CardContent>
            </Card>

            <Card className="border-2 border-green-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  <Badge variant="outline" className="mr-2 text-[10px] border-green-500/40 text-green-600 dark:text-green-400">TREND</Badge>
                  Trend Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Compares a base metric across two time windows to calculate period-over-period change.</p>
                <pre className="rounded bg-muted p-2 text-xs font-mono overflow-auto">
{`{
  "baseMetricSlug": "total-findings",
  "compareWindow": "7d",
  "currentWindow": "7d"
}`}
                </pre>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Live Values Visualization */}
        <section id="live-metric-values" className="scroll-mt-24 space-y-4">
          <h2 className="font-serif text-2xl font-black uppercase tracking-[0.08em]">
            Live Metric Values
          </h2>
          <p className="text-muted-foreground">
            Governed metrics are evaluated in real-time against the database. The cards below show
            sample output from the metric engine.
          </p>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {activeMetrics.map((metric) => (
              <Card key={metric.slug} className="border-2">
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs text-muted-foreground">
                    {metric.displayName}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-mono text-3xl font-bold tracking-tight">
                    {formatMetricValue(metric.currentValue, metric.format)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{metric.unit}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Dimension Breakdown */}
        <section id="dimension-breakdowns" className="scroll-mt-24 space-y-4">
          <h2 className="font-serif text-2xl font-black uppercase tracking-[0.08em]">
            Dimension Breakdowns
          </h2>
          <p className="text-muted-foreground">
            Metrics can be sliced by allowed dimensions. The metric engine returns both the scalar
            value and an optional breakdown array.
          </p>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {mockMetricResults
              .filter((r) => r.breakdown.length > 0)
              .map((result) => {
                const meta = mockMetricDefinitions.find((m) => m.slug === result.metricSlug);
                const maxVal = Math.max(...result.breakdown.map((b) => b.value), 1);

                return (
                  <Card key={result.metricSlug} className="border-2">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">
                        {meta?.displayName ?? result.metricSlug}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {result.breakdown.map((b) => (
                        <div key={b.dimensionValue} className="flex items-center gap-3">
                          <span className="w-28 text-xs font-medium truncate">
                            {b.dimensionValue}
                          </span>
                          <div className="flex-1">
                            <div
                              className="h-5 rounded bg-accent/60"
                              style={{
                                width: `${(b.value / maxVal) * 100}%`,
                                minWidth: "4px",
                              }}
                            />
                          </div>
                          <span className="w-14 text-right font-mono text-xs">
                            {b.value.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </section>

        {/* Getting Started */}
        <section id="getting-started" className="scroll-mt-24 space-y-4">
          <h2 className="font-serif text-2xl font-black uppercase tracking-[0.08em]">
            Getting Started
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="border-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">1. Define Glossary Terms</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Navigate to <code className="font-mono text-xs">/semantic/glossary/new</code> in
                the web app. Map a business concept to detector types, severities, or statuses.
                Preview how many findings match before saving.
              </CardContent>
            </Card>
            <Card className="border-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">2. Create Metrics</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Go to <code className="font-mono text-xs">/semantic/metrics/new</code>. Choose a
                type (SIMPLE, RATIO, DERIVED, TREND), configure the definition, and select which
                dimensions can slice it.
              </CardContent>
            </Card>
            <Card className="border-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">3. Certify &amp; Govern</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Metrics start in DRAFT status. Certify them to mark as ACTIVE. Certified metrics
                carry governance metadata: owner, certification date, and certifier identity.
              </CardContent>
            </Card>
            <Card className="border-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">4. Explore &amp; Query</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Use the Metric Explorer at <code className="font-mono text-xs">/semantic/explore</code> to
                interactively query metrics with glossary term scoping and dimension breakdowns.
              </CardContent>
            </Card>
          </div>
        </section>

        {/* API Reference Summary */}
        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-black uppercase tracking-[0.08em]">
            API Reference
          </h2>
          <p className="text-muted-foreground">
            The semantic layer exposes REST endpoints under <code className="font-mono text-xs">/semantic/</code>.
            See the sub-pages for detailed endpoint documentation.
          </p>

          <div className="overflow-auto rounded-lg border-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2 text-left font-medium">Method</th>
                  <th className="px-4 py-2 text-left font-medium">Endpoint</th>
                  <th className="px-4 py-2 text-left font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                <tr className="border-b">
                  <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">GET</Badge></td>
                  <td className="px-4 py-2">/semantic/glossary</td>
                  <td className="px-4 py-2 font-sans">List all glossary terms</td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">POST</Badge></td>
                  <td className="px-4 py-2">/semantic/glossary</td>
                  <td className="px-4 py-2 font-sans">Create a glossary term</td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">GET</Badge></td>
                  <td className="px-4 py-2">/semantic/metrics</td>
                  <td className="px-4 py-2 font-sans">List all metric definitions</td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">POST</Badge></td>
                  <td className="px-4 py-2">/semantic/metrics</td>
                  <td className="px-4 py-2 font-sans">Create a metric definition</td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">POST</Badge></td>
                  <td className="px-4 py-2">/semantic/metrics/:slug/certify</td>
                  <td className="px-4 py-2 font-sans">Certify a metric (DRAFT &rarr; ACTIVE)</td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">POST</Badge></td>
                  <td className="px-4 py-2">/semantic/query</td>
                  <td className="px-4 py-2 font-sans">Evaluate a metric with filters</td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">POST</Badge></td>
                  <td className="px-4 py-2">/semantic/query/timeseries</td>
                  <td className="px-4 py-2 font-sans">Evaluate metric as time series</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">POST</Badge></td>
                  <td className="px-4 py-2">/semantic/query/dashboard</td>
                  <td className="px-4 py-2 font-sans">Batch-evaluate dashboard metrics</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </NextraPageShell>
  );
}

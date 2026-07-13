import { expect, test } from "@playwright/experimental-ct-react";
import type { CorrelationGraphResponseDto, GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { FingerprintsGraph } from "@/components/fingerprints-graph";

const ASSET_COUNT = 300;
const FINDING_COUNT = 1200;

/**
 * Build a dense bipartite graph: `assetCount` assets, each connected to
 * `FINDINGS_PER_ASSET` distinct findings, with findings shared across
 * ~3 assets each to create a dense realistic structure.
 */
function buildLargeGraph(): CorrelationGraphResponseDto {
  const nodes: GraphNodeDto[] = [];
  const edges: GraphEdgeDto[] = [];

  const sources = ["confluence", "jira", "sharepoint", "s3", "slack"];
  const types = ["document", "page", "attachment", "message", "ticket"];
  const detectors = ["PII", "SECRETS", "TOXICITY", "CREDIT_CARD", "PHONE", "EMAIL", "IP", "URL", "SSN", "CUSTOM"];
  const severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

  for (let i = 0; i < ASSET_COUNT; i++) {
    nodes.push({
      id: `asset-${i}`,
      type: "asset",
      label: `Asset ${i} — ${types[i % types.length]}`,
      depth: 1,
      sourceType: sources[i % sources.length],
      assetType: types[i % types.length],
    });
  }

  let edgeId = 0;
  for (let fi = 0; fi < FINDING_COUNT; fi++) {
    const detector = detectors[fi % detectors.length];
    const severity = severities[fi % severities.length];
    const findingId = `finding-${fi}`;

    nodes.push({
      id: findingId,
      type: "finding",
      label: `${detector}: value-${fi}`,
      depth: 2,
      detectorType: detector,
      severity,
    });

    const targetAssets = new Set<number>();
    targetAssets.add(fi % ASSET_COUNT);
    targetAssets.add((fi * 3) % ASSET_COUNT);
    targetAssets.add((fi * 7 + 5) % ASSET_COUNT);

    for (const ai of targetAssets) {
      edges.push({
        id: `edge-${edgeId++}`,
        fromType: "asset",
        fromId: `asset-${ai}`,
        toType: "finding",
        toId: findingId,
        relationType: "has_finding",
        confidence: 0.5 + Math.random() * 0.5,
        origin: "SOURCE_DERIVED",
      });
    }
  }

  return { nodes, edges, truncated: false, similarities: [] };
}

test.describe("graph performance", () => {
  test("renders 300 assets + 1200 findings at acceptable frame rate", async ({ mount, page }) => {
    await page.addStyleTag({
      content: `
        :root {
          --background: #ffffff;
          --foreground: #0a0a0a;
          --muted-foreground: #737373;
          --card: #f5f5f5;
          --font-mono: "SF Mono", "Fira Code", monospace;
        }
      `,
    });

    const testData = buildLargeGraph();

    // Mock instance-settings (the provider requests this on mount)
    await page.route("**/instance-settings**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          aiEnabled: false,
          mcpEnabled: false,
          demoMode: false,
          language: "ENGLISH",
          timezone: "UTC",
          timeFormat: "TWELVE_HOUR",
          aiProviderConfigId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      });
    });

    // Mock the correlation graph API
    await page.route("**/graph**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(testData),
      });
    });

    await mount(<FingerprintsGraph />);

    const canvas = page.locator("canvas");
    await expect(canvas).toBeAttached({ timeout: 10_000 });

    // Wait until the canvas has been drawn to (non-empty pixels)
    await expect(async () => {
      const hasContent = await canvas.evaluate((el: HTMLCanvasElement) => {
        const ctx = el.getContext("2d");
        if (!ctx) return false;
        const d = ctx.getImageData(0, 0, Math.min(el.width, 50), Math.min(el.height, 50)).data;
        return d.some((v) => v > 0 && v < 255);
      });
      expect(hasContent).toBe(true);
    }).toPass({ timeout: 10_000 });

    // Measure rAF rate over 3 seconds
    const fps = await page.evaluate(async () => {
      return new Promise<number>((resolve) => {
        let frames = 0;
        let startTime = 0;

        function tick(now: number) {
          if (!startTime) startTime = now;
          frames++;
          const elapsed = now - startTime;
          if (elapsed >= 3000) {
            resolve((frames / elapsed) * 1000);
          } else {
            requestAnimationFrame(tick);
          }
        }

        requestAnimationFrame(tick);
      });
    });

    expect(fps).toBeGreaterThan(15);

    // Clustering must have collapsed the hairball: the toolbar chip lists the
    // detected communities and the sidebar ranks them as hotspots.
    await expect(page.getByText(/\d+ clusters/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/hotspots/i)).toBeVisible();

    // Drilling into the top hotspot expands it (chip gains the Overview reset).
    await page.getByText(/hotspots/i).locator("..").locator("button").first().click();
    await expect(page.getByText(/overview/i).first()).toBeVisible({ timeout: 5_000 });
  });
});

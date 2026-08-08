import { expect, test } from "@playwright/experimental-ct-react";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { FingerprintsConnections } from "@/components/fingerprints-connections";
import { ClusterDetailHarness } from "./fixtures/cluster-detail-harness";
import type { ClusterMeta } from "@/components/graph-explorer/use-clustered-graph";

/**
 * Two documents from the same S3 source sharing one value, plus a finding of
 * their own — the smallest shape that exercises every drill-down link.
 */
const ASSET_A: GraphNodeDto = {
  id: "asset-a",
  type: "asset",
  label: "quarterly-report.pdf",
  depth: 1,
  sourceType: "S3_COMPATIBLE_STORAGE",
  sourceId: "source-1",
  sourceName: "Enron Email Archive",
};

const ASSET_B: GraphNodeDto = {
  ...ASSET_A,
  id: "asset-b",
  label: "board-minutes.pdf",
};

const SHARED_VALUE: GraphNodeDto = {
  id: "finding-1",
  type: "finding",
  label: "k.lay@enron.com",
  depth: 2,
  detectorType: "EMAIL",
  severity: "HIGH",
};

const EDGES: GraphEdgeDto[] = [ASSET_A, ASSET_B].map((asset, i) => ({
  id: `edge-${i}`,
  fromType: "asset",
  fromId: asset.id,
  toType: "finding",
  toId: SHARED_VALUE.id,
  relationType: "has_finding",
  confidence: 0.9,
  origin: "SOURCE_DERIVED",
}));

const CLUSTER: ClusterMeta = {
  id: "c-test",
  memberKeys: ["asset:asset-a", "asset:asset-b", "finding:finding-1"],
  size: 3,
  assetCount: 2,
  findingCount: 1,
  severityCounts: { HIGH: 1 },
  topSeverity: "HIGH",
  sources: [
    {
      id: "source-1",
      name: "Enron Email Archive",
      type: "S3_COMPATIBLE_STORAGE",
      assetCount: 2,
    },
  ],
  dominantSourceType: "S3_COMPATIBLE_STORAGE",
  label: "Enron Email Archive",
};

const MEMBERS = [
  { key: "asset:asset-a", node: ASSET_A },
  { key: "asset:asset-b", node: ASSET_B },
  { key: "finding:finding-1", node: SHARED_VALUE },
];

test.describe("cluster detail panel", () => {
  test("names the real source and its translated type, never the raw enum", async ({
    mount,
  }) => {
    const panel = await mount(
      <ClusterDetailHarness meta={CLUSTER} members={MEMBERS} />,
    );

    await expect(panel.getByText("Enron Email Archive").first()).toBeVisible();
    await expect(panel.getByText("S3-Compatible Storage")).toBeVisible();
    await expect(panel.getByText("S3_COMPATIBLE_STORAGE")).toHaveCount(0);
  });

  test("links to the source detail page when the cluster has exactly one source", async ({
    mount,
  }) => {
    const panel = await mount(
      <ClusterDetailHarness meta={CLUSTER} members={MEMBERS} />,
    );

    await expect(
      panel.getByRole("link", { name: /open source/i }),
    ).toHaveAttribute("href", "/sources/source-1");
  });

  test("splits members into documents and severity-banded findings, all clickable", async ({
    mount,
  }) => {
    const panel = await mount(
      <ClusterDetailHarness meta={CLUSTER} members={MEMBERS} />,
    );

    await expect(panel.getByText("Documents")).toBeVisible();
    await expect(panel.getByText("HIGH")).toBeVisible();

    await expect(
      panel.getByRole("link", { name: /board-minutes\.pdf/ }),
    ).toHaveAttribute("href", "/assets/asset-b");
    await expect(
      panel.getByRole("link", { name: /k\.lay@enron\.com/ }),
    ).toHaveAttribute("href", "/findings/finding-1");
  });

  test("does not link bundle stand-ins, which address no finding row", async ({
    mount,
  }) => {
    const bundle: GraphNodeDto = {
      id: "bundle-node:asset-a|asset-b",
      type: "finding",
      label: "12 shared values",
      depth: 1,
      detectorType: "BUNDLE",
    };
    const panel = await mount(
      <ClusterDetailHarness
        meta={{ ...CLUSTER, memberKeys: [`finding:${bundle.id}`] }}
        members={[{ key: `finding:${bundle.id}`, node: bundle }]}
      />,
    );

    await expect(panel.getByText("12 shared values")).toBeVisible();
    await expect(
      panel.getByRole("link", { name: /shared values/ }),
    ).toHaveCount(0);
  });
});

test.describe("connections panel", () => {
  test("asset names are links without expanding the row", async ({ mount }) => {
    const panel = await mount(
      <FingerprintsConnections
        nodes={[ASSET_A, ASSET_B, SHARED_VALUE]}
        edges={EDGES}
        similarities={[]}
        loading={false}
        error={null}
        onReload={() => {}}
      />,
    );

    await expect(
      panel.getByRole("link", { name: "quarterly-report.pdf" }),
    ).toHaveAttribute("href", "/assets/asset-a");
    await expect(
      panel.getByRole("link", { name: "board-minutes.pdf" }),
    ).toHaveAttribute("href", "/assets/asset-b");
  });

  test("loads a shared value lazily and links each source to its real finding", async ({
    mount,
    page,
  }) => {
    let occurrenceRequests = 0;
    await page.route("**/findings/occurrences**", async (route) => {
      occurrenceRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          label: "email",
          value: "k.lay@enron.com",
          valueHash: SHARED_VALUE.id,
          assets: [
            {
              assetId: ASSET_A.id,
              findingId: "8a9dda05-f035-46cd-8fa0-1ad864a39d14",
              name: ASSET_A.label,
              externalUrl: "",
              assetType: "EMAIL",
              sourceType: ASSET_A.sourceType,
              sourceId: ASSET_A.sourceId,
              sourceName: ASSET_A.sourceName,
              clusterId: null,
            },
          ],
        }),
      });
    });
    const panel = await mount(
      <FingerprintsConnections
        nodes={[ASSET_A, ASSET_B, SHARED_VALUE]}
        edges={EDGES}
        similarities={[]}
        loading={false}
        error={null}
        onReload={() => {}}
      />,
    );

    await panel.getByRole("button", { expanded: false }).click();
    expect(occurrenceRequests).toBe(0);

    const sharedValue = panel.getByRole("button", {
      name: /show matching findings by source/i,
    });
    await sharedValue.click();

    await expect(
      panel.getByRole("link", {
        name: /open finding from enron email archive/i,
      }),
    ).toHaveAttribute("href", "/findings/8a9dda05-f035-46cd-8fa0-1ad864a39d14");
    expect(occurrenceRequests).toBe(1);

    await sharedValue.click();
    await sharedValue.click();
    await expect(
      panel.getByRole("link", {
        name: /open finding from enron email archive/i,
      }),
    ).toBeVisible();
    expect(occurrenceRequests).toBe(1);
  });
});

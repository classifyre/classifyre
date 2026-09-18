/**
 * Finding detail titles lead with the detection signal, then the asset — and
 * never with the detected secret itself.
 */

import { seoEntityName } from "./seo-entity";

function mockFindingBody(body: Record<string, unknown>): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("seoEntityName finding", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("combines signal and asset name, signal first", async () => {
    mockFindingBody({
      findingType: "AWS Secret Key",
      category: "SECRETS",
      asset: { name: "Q3 Invoices" },
    });

    await expect(seoEntityName("finding", "acme", "f-1")).resolves.toBe(
      "AWS Secret Key · Q3 Invoices",
    );
  });

  it("falls back to the category when findingType is missing", async () => {
    mockFindingBody({
      category: "PII",
      asset: { name: "Support Inbox" },
    });

    await expect(seoEntityName("finding", "acme", "f-1")).resolves.toBe(
      "PII · Support Inbox",
    );
  });

  it("falls back to externalUrl, then location path, for unnamed assets", async () => {
    mockFindingBody({
      findingType: "IBAN",
      asset: { externalUrl: "https://wiki.acme.test/x" },
    });
    await expect(seoEntityName("finding", "acme", "f-1")).resolves.toBe(
      "IBAN · https://wiki.acme.test/x",
    );

    mockFindingBody({
      findingType: "IBAN",
      asset: {},
      location: { path: "/shared/exports/customers.csv" },
    });
    await expect(seoEntityName("finding", "acme", "f-1")).resolves.toBe(
      "IBAN · /shared/exports/customers.csv",
    );
  });

  it("keeps the signal alone when no asset name is known", async () => {
    mockFindingBody({ findingType: "AWS Secret Key" });

    await expect(seoEntityName("finding", "acme", "f-1")).resolves.toBe(
      "AWS Secret Key",
    );
  });

  it("truncates long signals and asset names instead of stuffing the title", async () => {
    mockFindingBody({
      findingType: `${"S".repeat(100)}ecret`,
      asset: { name: `${"A".repeat(80)}.pdf` },
    });

    const name = await seoEntityName("finding", "acme", "f-1");
    expect(name).toContain("…");
    expect(name?.length).toBeLessThanOrEqual(120);
    // The signal still leads even after truncation.
    expect(name?.startsWith("S")).toBe(true);
  });

  it("never surfaces matched or redacted content", async () => {
    mockFindingBody({
      matchedContent: "AKIAIOSFODNN7EXAMPLE",
      redactedContent: "AKIA…",
      contextBefore: "aws_access_key_id =",
    });

    // Null lets entityMetadata fall back to the generic section copy rather
    // than interpolating a secret into <title>.
    await expect(seoEntityName("finding", "acme", "f-1")).resolves.toBeNull();
  });

  it("returns null when the lookup fails", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("upstream down")) as unknown as typeof fetch;

    await expect(seoEntityName("finding", "acme", "f-1")).resolves.toBeNull();
  });
});

/**
 * Pins the three defects that shipped in the first pass at page metadata:
 * a canonical pointing at classifyre.com from every self-hosted instance,
 * `index, follow` on a deployment whose robots.txt says `Disallow: /`, and a
 * raw UUID interpolated into `<title>`.
 */

import type { Metadata } from "next";

import { entityMetadata, sectionMetadata, siteMetadata } from "./seo-metadata";

// Deliberately not a *.classifyre.com host: the defect being pinned was a
// self-hosted instance declaring the marketing domain as its own canonical.
const BASE = "https://data.acme-internal.test";

describe("seo metadata", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set explicitly so the builders never reach for request headers, which
    // are unavailable outside a render.
    process.env.SITEMAP_BASE_URL = BASE;
    delete process.env.SITEMAP_ENABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("canonical and alternates", () => {
    it("uses the configured origin, not a hardcoded one", async () => {
      const meta = await sectionMetadata("en", "seo.findings", {
        namespaceSlug: "acme",
        path: "/findings",
      });

      expect(meta.alternates?.canonical).toBe(`${BASE}/acme/findings/`);
      expect(String(meta.alternates?.canonical)).not.toContain(
        "classifyre.com",
      );
    });

    it("prefixes only the non-default locale", async () => {
      const en = await sectionMetadata("en", "seo.findings", {
        namespaceSlug: "acme",
        path: "/findings",
      });
      const de = await sectionMetadata("de", "seo.findings", {
        namespaceSlug: "acme",
        path: "/findings",
      });

      expect(en.alternates?.canonical).toBe(`${BASE}/acme/findings/`);
      expect(de.alternates?.canonical).toBe(`${BASE}/de/acme/findings/`);
    });

    it("advertises both locales and an x-default on every page", async () => {
      const meta = await sectionMetadata("de", "seo.findings", {
        namespaceSlug: "acme",
        path: "/findings",
      });

      expect(meta.alternates?.languages).toEqual({
        en: `${BASE}/acme/findings/`,
        de: `${BASE}/de/acme/findings/`,
        "x-default": `${BASE}/acme/findings/`,
      });
    });

    it("omits absolute URLs entirely when the origin is unknown", async () => {
      delete process.env.SITEMAP_BASE_URL;
      delete process.env.PUBLIC_BASE_URL;
      const meta = await sectionMetadata("en", "seo.findings", {
        namespaceSlug: "acme",
        path: "/findings",
      });

      // Better no canonical than one on the wrong origin.
      expect(meta.alternates).toBeUndefined();
    });
  });

  describe("robots", () => {
    const robotsOf = (meta: Metadata) =>
      meta.robots as { index: boolean; follow: boolean };

    it("stays out of the index while the sitemap is disabled", async () => {
      // `frontend.sitemap.enabled` defaults to false because most instances
      // are private, and robots.txt then serves `Disallow: /`.
      expect(robotsOf(await siteMetadata("en")).index).toBe(false);
    });

    it("invites crawlers only once the deployment opts in", async () => {
      process.env.SITEMAP_ENABLED = "true";
      expect(robotsOf(await siteMetadata("en")).index).toBe(true);
    });
  });

  describe("entity titles", () => {
    it("uses the real name when one is known", async () => {
      const meta = await entityMetadata(
        "en",
        "seo.assetDetail",
        "Invoices Q3",
        {
          namespaceSlug: "acme",
          path: "/assets/abc",
        },
      );

      expect(meta.title).toContain("Invoices Q3");
      expect(meta.description).toContain("Invoices Q3");
      expect(meta.description).not.toContain("{{");
    });

    it("falls back to the generic section copy rather than showing an id", async () => {
      const generic = await sectionMetadata("en", "seo.assetDetail", {
        namespaceSlug: "acme",
        path: "/assets/abc",
      });
      const unresolved = await entityMetadata("en", "seo.assetDetail", null, {
        namespaceSlug: "acme",
        path: "/assets/abc",
      });

      expect(unresolved.title).toBe(generic.title);
      expect(unresolved.title).not.toContain("abc");
    });

    it("translates the entity template", async () => {
      const en = await entityMetadata("en", "seo.sourceDetail", "Wiki", {});
      const de = await entityMetadata("de", "seo.sourceDetail", "Wiki", {});

      expect(de.title).toContain("Wiki");
      expect(de.title).not.toBe(en.title);
    });
  });
});

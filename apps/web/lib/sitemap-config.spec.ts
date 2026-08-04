import {
  DEFAULT_SITEMAP_CHUNK_SIZE,
  SITEMAP_ENTITY_TYPES,
  appUrl,
  childSitemapUrl,
  entitySitemapFile,
  entityUrl,
  isSitemapEnabled,
  parseChildSitemapPath,
  renderRobots,
  renderSitemapIndex,
  renderUrlSet,
  resolveBaseUrl,
  sitemapChunkSize,
} from "./sitemap-config";

const ENV_KEYS = [
  "SITEMAP_ENABLED",
  "SITEMAP_BASE_URL",
  "PUBLIC_BASE_URL",
  "SITEMAP_CHUNK_SIZE",
] as const;

describe("sitemap-config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe("isSitemapEnabled", () => {
    it("is off unless explicitly enabled", () => {
      expect(isSitemapEnabled()).toBe(false);
      process.env.SITEMAP_ENABLED = "false";
      expect(isSitemapEnabled()).toBe(false);
      process.env.SITEMAP_ENABLED = "1";
      expect(isSitemapEnabled()).toBe(false);
      process.env.SITEMAP_ENABLED = "true";
      expect(isSitemapEnabled()).toBe(true);
    });
  });

  describe("sitemapChunkSize", () => {
    it("defaults and clamps", () => {
      expect(sitemapChunkSize()).toBe(DEFAULT_SITEMAP_CHUNK_SIZE);
      process.env.SITEMAP_CHUNK_SIZE = "abc";
      expect(sitemapChunkSize()).toBe(DEFAULT_SITEMAP_CHUNK_SIZE);
      process.env.SITEMAP_CHUNK_SIZE = "5";
      expect(sitemapChunkSize()).toBe(100);
      process.env.SITEMAP_CHUNK_SIZE = "999999";
      expect(sitemapChunkSize()).toBe(50_000);
      process.env.SITEMAP_CHUNK_SIZE = "2500";
      expect(sitemapChunkSize()).toBe(2_500);
    });
  });

  describe("resolveBaseUrl", () => {
    it("prefers the forwarded host and protocol", () => {
      const headers = new Headers({
        host: "web.svc.cluster.local:3100",
        "x-forwarded-host": "demo.classifyre.com",
        "x-forwarded-proto": "https,http",
      });
      expect(resolveBaseUrl(headers)).toBe("https://demo.classifyre.com");
    });

    it("falls back to Host, assuming https off-localhost", () => {
      expect(resolveBaseUrl(new Headers({ host: "example.com" }))).toBe(
        "https://example.com",
      );
      expect(resolveBaseUrl(new Headers({ host: "localhost:3100" }))).toBe(
        "http://localhost:3100",
      );
    });

    it("honours the explicit override and strips its trailing slash", () => {
      process.env.SITEMAP_BASE_URL = "https://canonical.example.com/";
      expect(resolveBaseUrl(new Headers({ host: "internal" }))).toBe(
        "https://canonical.example.com",
      );
    });

    it("returns null when there is no host to build URLs from", () => {
      expect(resolveBaseUrl(new Headers())).toBeNull();
    });
  });

  describe("URL building", () => {
    const base = "https://demo.classifyre.com";

    it("emits the trailing-slash form the app actually serves", () => {
      // next.config.mjs sets trailingSlash: true — the slash-less form 308s.
      expect(appUrl(base, null, "")).toBe(`${base}/`);
      expect(appUrl(base, null, "/docs")).toBe(`${base}/docs/`);
      expect(appUrl(base, "acme", "")).toBe(`${base}/acme/`);
      expect(appUrl(base, "acme", "/findings")).toBe(`${base}/acme/findings/`);
    });

    it("routes every entity type to its namespaced detail page", () => {
      expect(entityUrl(base, "acme", "finding", "f1")).toBe(
        `${base}/acme/findings/f1/`,
      );
      expect(entityUrl(base, "acme", "case", "c1")).toBe(
        `${base}/acme/investigations/c1/`,
      );
      expect(entityUrl(base, "acme", "inquiry", "i1")).toBe(
        `${base}/acme/investigations/inquiries/i1/`,
      );
      expect(entityUrl(base, "acme", "scan", "r1")).toBe(
        `${base}/acme/scans/r1/`,
      );
      expect(entityUrl(base, "acme", "detector", "d1")).toBe(
        `${base}/acme/detectors/d1/`,
      );
      expect(entityUrl(base, "acme", "source", "s1")).toBe(
        `${base}/acme/sources/s1/`,
      );
      expect(entityUrl(base, "acme", "asset", "a1")).toBe(
        `${base}/acme/assets/a1/`,
      );
    });

    it("round-trips every child sitemap URL it advertises", () => {
      for (const type of SITEMAP_ENTITY_TYPES) {
        const file = entitySitemapFile(type, 3);
        expect(childSitemapUrl(base, "acme", file)).toBe(
          `${base}/sitemap/acme/${file}`,
        );
        expect(parseChildSitemapPath(["acme", file])).toEqual({
          kind: "entity",
          namespaceSlug: "acme",
          type,
          chunk: 3,
        });
      }
      expect(parseChildSitemapPath(["pages.xml"])).toEqual({ kind: "global" });
      expect(parseChildSitemapPath(["acme", "pages.xml"])).toEqual({
        kind: "static",
        namespaceSlug: "acme",
      });
    });

    it("rejects unparseable child sitemap paths", () => {
      expect(parseChildSitemapPath([])).toBeNull();
      expect(parseChildSitemapPath(["acme"])).toBeNull();
      expect(parseChildSitemapPath(["acme", "widgets-0.xml"])).toBeNull();
      expect(parseChildSitemapPath(["acme", "finding-x.xml"])).toBeNull();
      expect(parseChildSitemapPath(["a/b", "finding-0.xml"])).toBeNull();
      expect(parseChildSitemapPath(["-bad-", "finding-0.xml"])).toBeNull();
      expect(
        parseChildSitemapPath(["acme", "extra", "finding-0.xml"]),
      ).toBeNull();
    });
  });

  describe("XML rendering", () => {
    it("omits lastmod when unknown and escapes URLs", () => {
      const xml = renderUrlSet([
        {
          url: "https://x.test/a&b/",
          lastModified: "2026-01-01T00:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.5,
        },
        { url: "https://x.test/c/", lastModified: null },
      ]);

      expect(xml).toContain("<loc>https://x.test/a&amp;b/</loc>");
      expect(xml).toContain("<lastmod>2026-01-01T00:00:00.000Z</lastmod>");
      expect(xml).toContain("<changefreq>weekly</changefreq>");
      expect(xml).toContain("<priority>0.5</priority>");
      expect(xml.match(/<lastmod>/g)).toHaveLength(1);
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
        true,
      );
    });

    it("normalises index lastmod to ISO-8601", () => {
      const xml = renderSitemapIndex([
        { url: "https://x.test/sitemap/pages.xml", lastModified: "2026-05-06" },
        { url: "https://x.test/sitemap/acme/finding-0.xml", lastModified: "nope" },
      ]);

      expect(xml).toContain("<lastmod>2026-05-06T00:00:00.000Z</lastmod>");
      expect(xml.match(/<lastmod>/g)).toHaveLength(1);
      expect(xml).toContain("<sitemapindex");
    });
  });

  describe("renderRobots", () => {
    it("blocks everything while the sitemap is disabled", () => {
      expect(renderRobots("https://x.test")).toBe(
        "User-agent: *\nDisallow: /\n",
      );
    });

    it("invites crawlers and advertises the index once enabled", () => {
      process.env.SITEMAP_ENABLED = "true";
      const body = renderRobots("https://demo.classifyre.com");

      expect(body).toContain("Allow: /");
      expect(body).toContain("Sitemap: https://demo.classifyre.com/sitemap.xml");
      expect(body).toContain("Disallow: /api/");
      expect(body).toContain("Disallow: /*/settings/");
    });

    it("blocks everything when the hostname cannot be resolved", () => {
      process.env.SITEMAP_ENABLED = "true";
      expect(renderRobots(null)).toBe("User-agent: *\nDisallow: /\n");
    });
  });
});

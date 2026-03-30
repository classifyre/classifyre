export const SITEMAP_TEST_XML = 'https://www.classifyre.com/sitemap.xml';

export function createSitemapSourceConfig(withDetectors = false) {
  const config: any = {
    type: 'SITEMAP',
    required: {
      sitemap_url: SITEMAP_TEST_XML,
    },
    optional: {
      crawl: {
        max_pages: 10,
        max_nested_sitemaps: 50,
        request_timeout_seconds: 30,
        crawl_page_timeout_ms: 120000,
      },
      assets: {
        max_related_assets_per_page: 20,
        fetch_related_assets: true,
        include_external_links: false,
      },
    },
  };

  if (withDetectors) {
    config.detectors = [
      {
        type: 'BROKEN_LINKS',
        enabled: true,
      },
    ];
  }

  return config;
}

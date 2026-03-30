export const WORDPRESS_TEST_URL = 'https://wordpress.tribitat.com';

export function createWordPressSourceConfig(withDetectors = false) {
  const config: any = {
    type: 'WORDPRESS',
    required: {
      url: WORDPRESS_TEST_URL,
    },
    masked: {},
    optional: {
      content: {
        fetch_posts: true,
        fetch_pages: false,
        limit_total_items: 3,
      },
    },
  };

  if (withDetectors) {
    config.detectors = [
      {
        type: 'PII',
        enabled: true,
        config: { confidence_threshold: 0.7 },
      },
      {
        type: 'SECRETS',
        enabled: true,
        config: { confidence_threshold: 0.9 },
      },
    ];
  }

  return config;
}

/**
 * Navbar configuration for the marketing site.
 *
 * Nextra builds the navbar from this page map, so dropdowns use `type: 'menu'`
 * and fold cleanly into Nextra's mobile drawer below `md`.
 */
export default {
  index: {
    type: "page",
    title: "Home",
    display: "hidden",
  },
  platform: {
    type: "menu",
    title: "Platform",
    items: {
      governance: {
        title: "Data Access Governance",
        href: "/data-access-governance",
      },
      sources: {
        title: "Supported Sources",
        href: "/sources",
      },
      deploy: {
        title: "Deploy & Self-Host",
        href: "/get",
      },
      incident: {
        title: "Incident Response",
        href: "/use-cases/incident-response",
      },
    },
  },
  compare: {
    type: "menu",
    title: "Compare",
    items: {
      immuta: {
        title: "vs Immuta",
        href: "/immuta-alternative",
      },
      unity: {
        title: "vs Unity Catalog",
        href: "/unity-catalog-alternative",
      },
    },
  },
  journal: {
    type: "menu",
    title: "Blog",
    items: {
      overview: {
        title: "All publications",
        href: "/blog",
      },
      articles: {
        title: "Articles",
        href: "/blog/articles",
      },
      cases: {
        title: "Case files",
        href: "/blog/cases",
      },
    },
  },
  blog: {
    type: "page",
    title: "Blog",
    display: "hidden",
  },
  documentation: {
    type: "page",
    title: "Docs",
    href: "https://docs.classifyre.com/",
  },
  get: {
    type: "page",
    title: "Deploy Classifyre",
    display: "hidden",
  },
  download: {
    type: "page",
    title: "Download (moved)",
    display: "hidden",
  },
  sources: {
    type: "page",
    title: "Sources",
    display: "hidden",
  },
  support: {
    type: "page",
    title: "Support",
    display: "hidden",
  },
  "made-in-europe": {
    type: "page",
    title: "About Classifyre",
    display: "hidden",
  },
  "data-access-governance": {
    type: "page",
    title: "Data Access Governance",
    display: "hidden",
  },
  "use-cases": {
    type: "page",
    title: "Use cases",
    display: "hidden",
  },
  "immuta-alternative": {
    type: "page",
    title: "Immuta alternative",
    display: "hidden",
  },
  "unity-catalog-alternative": {
    type: "page",
    title: "Unity Catalog alternative",
    display: "hidden",
  },
  privacy: {
    type: "page",
    title: "Privacy & cookie policy",
    display: "hidden",
  },
  impressum: {
    type: "page",
    title: "Legal notice",
    display: "hidden",
  },
  "release-notes": {
    type: "page",
    title: "Release notes",
    display: "hidden",
  },
};

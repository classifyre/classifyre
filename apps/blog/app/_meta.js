/**
 * Navbar configuration for the marketing site.
 *
 * Nextra builds the navbar from this page map, so the "Product" dropdown is a
 * `type: 'menu'` entry rather than a hand-rolled one — it then renders with
 * the theme's own menu (HeadlessUI, the same primitive behind the search and
 * theme controls) and, below `md`, folds into Nextra's mobile drawer for free.
 *
 * The three marketing routes are `display: 'hidden'` so they appear once, in
 * the menu, instead of also sitting in the navbar as top-level entries.
 */
export default {
  index: {
    type: "page",
    title: "Home",
    display: "hidden",
  },
  product: {
    type: "menu",
    title: "Product",
    items: {
      get: {
        title: "Get Classifyre",
        href: "/get",
      },
      sources: {
        title: "Sources",
        href: "/sources",
      },
    },
  },
  journal: {
    type: "menu",
    title: "Blog",
    items: {
      overview: {
        title: "Publication overview",
        href: "/blog",
      },
      articles: {
        title: "Blog",
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
    title: "Documentation",
    href: "https://docs.classifyre.com/",
  },
  get: {
    type: "page",
    title: "Get Classifyre",
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
  "made-in-europe": {
    type: "page",
    title: "Made in Austria",
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
  // Reachable from the footer only — a legal page does not belong in the
  // navbar, but it still needs a page-map entry to render inside the layout.
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

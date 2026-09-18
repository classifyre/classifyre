/**
 * German navbar, mirroring `app/_meta.js`.
 *
 * Placement is load-bearing: Nextra keys `_meta` files by their raw directory
 * (`de/…`), while page routes inside `app/(de)/…` are normalized to the same
 * `de/…` keys (route groups are transparent). A `_meta` file *inside* the
 * `(de)` group would key as `(de)/de/…` and never match its pages — so the
 * German meta files live here, next to no pages, and the German pages live in
 * `app/(de)/de/…` with no meta files of their own.
 */
export default {
  index: {
    type: "page",
    title: "Start",
    display: "hidden",
  },
  product: {
    type: "menu",
    title: "Produkt",
    items: {
      get: {
        title: "Classifyre holen",
        href: "/de/get",
      },
      sources: {
        title: "Quellen",
        href: "/de/sources",
      },
      editions: {
        title: "Open Source vs. Enterprise",
        href: "/de/open-source-vs-enterprise",
      }
    },
  },
  journal: {
    type: "menu",
    title: "Blog",
    items: {
      overview: {
        title: "Publikationsübersicht",
        href: "/de/blog",
      },
      articles: {
        title: "Business-Blog",
        href: "/de/blog/articles",
      },
      cases: {
        title: "Fallakten",
        href: "/de/blog/cases",
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
    title: "Dokumentation",
    href: "https://docs.classifyre.com/",
  },
  get: {
    type: "page",
    title: "Classifyre holen",
    display: "hidden",
  },
  download: {
    type: "page",
    title: "Download (verschoben)",
    display: "hidden",
  },
  sources: {
    type: "page",
    title: "Quellen",
    display: "hidden",
  },
  "open-source-vs-enterprise": {
    type: "page",
    title: "Open Source vs. Enterprise",
    display: "hidden",
  },
  "made-in-europe": {
    type: "page",
    title: "Made in Austria",
    display: "hidden",
  },
  // Reachable from the footer only — a legal page does not belong in the
  // navbar, but it still needs a page-map entry to render inside the layout.
  privacy: {
    type: "page",
    title: "Datenschutz- & Cookie-Richtlinie",
    display: "hidden",
  },
};

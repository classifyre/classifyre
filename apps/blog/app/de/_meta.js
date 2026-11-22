/**
 * German navbar, mirroring `app/_meta.js`.
 *
 * Placement is load-bearing: Nextra keys `_meta` files by their raw directory
 * (`de/…`), while page routes inside `app/(de)/…` are normalized to the same
 * `de/…` keys (route groups are transparent).
 */
export default {
  index: {
    type: "page",
    title: "Start",
    display: "hidden",
  },
  platform: {
    type: "menu",
    title: "Plattform",
    items: {
      governance: {
        title: "Berechtigungskonzept umsetzen",
        href: "/de/berechtigungskonzept-umsetzen",
      },
      sources: {
        title: "Unterstützte Quellen",
        href: "/de/sources",
      },
      deploy: {
        title: "Installation & Betrieb",
        href: "/de/get",
      },
      incident: {
        title: "Vorfallbearbeitung",
        href: "/de/use-cases/incident-response",
      },
    },
  },
  compare: {
    type: "menu",
    title: "Vergleich",
    items: {
      immuta: {
        title: "vs. Immuta",
        href: "/de/immuta-alternative",
      },
      unity: {
        title: "vs. Unity Catalog",
        href: "/de/unity-catalog-alternative",
      },
    },
  },
  about: {
    type: "page",
    title: "Über uns",
    href: "/de/made-in-europe",
  },
  supportLink: {
    type: "page",
    title: "Support",
    href: "/de/support",
  },
  journal: {
    type: "menu",
    title: "Blog",
    items: {
      overview: {
        title: "Alle Publikationen",
        href: "/de/blog",
      },
      articles: {
        title: "Artikel",
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
    title: "Doku",
    href: "https://docs.classifyre.com/",
  },
  get: {
    type: "page",
    title: "Installation",
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
  support: {
    type: "page",
    title: "Support",
    display: "hidden",
  },
  "made-in-europe": {
    type: "page",
    title: "Über Classifyre",
    display: "hidden",
  },
  "berechtigungskonzept-umsetzen": {
    type: "page",
    title: "Berechtigungskonzept umsetzen",
    display: "hidden",
  },
  "use-cases": {
    type: "page",
    title: "Anwendungsfälle",
    display: "hidden",
  },
  "immuta-alternative": {
    type: "page",
    title: "Immuta-Alternative",
    display: "hidden",
  },
  "unity-catalog-alternative": {
    type: "page",
    title: "Unity-Catalog-Alternative",
    display: "hidden",
  },
  privacy: {
    type: "page",
    title: "Datenschutz- & Cookie-Richtlinie",
    display: "hidden",
  },
  impressum: {
    type: "page",
    title: "Impressum",
    display: "hidden",
  },
  "release-notes": {
    type: "page",
    title: "Release Notes",
    display: "hidden",
  },
};

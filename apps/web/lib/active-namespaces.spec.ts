import {
  filterExistingNamespaces,
  hrefInCurrentLocale,
  type ActiveNamespace,
} from "./active-namespaces";

function tab(
  id: string,
  slug: string,
  name = slug,
): ActiveNamespace {
  return { id, slug, name, href: `/${slug}` };
}

describe("filterExistingNamespaces", () => {
  it("keeps tabs whose id or slug still exists", () => {
    const items = [tab("id-a", "alpha"), tab("id-b", "beta")];
    expect(
      filterExistingNamespaces(items, [
        { id: "id-a", slug: "alpha-renamed" },
        { id: "other-id", slug: "beta" },
      ]),
    ).toEqual(items);
  });

  it("drops tabs for deleted workspaces", () => {
    const items = [
      tab("id-a", "alpha"),
      tab("id-gone", "gone"),
      tab("id-b", "beta"),
    ];
    expect(
      filterExistingNamespaces(items, [
        { id: "id-a", slug: "alpha" },
        { id: "id-b", slug: "beta" },
      ]),
    ).toEqual([tab("id-a", "alpha"), tab("id-b", "beta")]);
  });

  it("drops everything when the registry is empty", () => {
    expect(filterExistingNamespaces([tab("id-a", "alpha")], [])).toEqual([]);
  });
});

describe("hrefInCurrentLocale", () => {
  it("leaves an href without a locale prefix untouched on the default route", () => {
    expect(hrefInCurrentLocale("/alpha/findings", "/beta/scans")).toBe(
      "/beta/scans",
    );
  });

  it("adds the locale prefix when switching namespaces from a switched route", () => {
    expect(hrefInCurrentLocale("/de/alpha", "/beta")).toBe("/de/beta");
    expect(
      hrefInCurrentLocale("/de/alpha/findings", "/beta/scans?tab=runs#top"),
    ).toBe("/de/beta/scans?tab=runs#top");
  });

  it("keeps the locale when the stored href already carries it", () => {
    expect(hrefInCurrentLocale("/de/alpha", "/de/beta")).toBe("/de/beta");
  });

  it("replaces a stale locale prefix with the current route locale", () => {
    expect(hrefInCurrentLocale("/alpha", "/de/beta")).toBe("/beta");
    expect(hrefInCurrentLocale("/de/alpha", "/beta")).toBe("/de/beta");
  });

  it("maps the directory root into the current language", () => {
    expect(hrefInCurrentLocale("/de/alpha", "/")).toBe("/de");
    expect(hrefInCurrentLocale("/alpha", "/")).toBe("/");
  });
});

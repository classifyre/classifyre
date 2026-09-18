import {
  filterExistingNamespaces,
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

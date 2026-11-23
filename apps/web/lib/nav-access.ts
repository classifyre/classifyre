/**
 * Which sidebar entries a person is offered. An entry may name the capability
 * its page needs; the API stays the authority, this only keeps people from
 * pages that would refuse them. Until `/me` answers (`capabilities` null)
 * everything is shown, so most people see no entries appear late.
 */
export function visibleNav<
  I extends { capability?: string },
  G extends { items: I[] },
>(groups: readonly G[], capabilities: readonly string[] | null): G[] {
  if (!capabilities) return [...groups];
  const held = new Set(capabilities);
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.capability || held.has(item.capability),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

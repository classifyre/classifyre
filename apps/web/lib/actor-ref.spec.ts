import { actorKind, needsResolving } from "./actor-ref";

/**
 * The web's copy of the API's actor-reference grammar
 * (apps/api/src/identity/actor-ref.ts). The same references as the API's
 * spec, so the two cannot drift apart unnoticed.
 */
describe("actor references", () => {
  it.each([
    ["user:9f2c", "user"],
    ["user:9f2c@mcp:41ab-77", "user"],
    ["user:9f2c@sql:559880b7-e99c-4d83-bf89-857149aeec9f", "user"],
    ["group:g-1", "group"],
    ["mcp:41ab", "mcp"],
    ["agent:autopilot", "agent"],
    ["system:quality", "system"],
    ["Jordan Reyes", "name"],
    ["user:9f2c@other:1", "name"],
  ])("%s is a %s", (ref: string, kind: string) => {
    expect(actorKind(ref)).toBe(kind as ReturnType<typeof actorKind>);
  });

  it("asks the API to name people, groups, tokens and connections", () => {
    expect(needsResolving("user:9f2c@sql:abc")).toBe(true);
    expect(needsResolving("user:9f2c@mcp:abc")).toBe(true);
    expect(needsResolving("system:quality")).toBe(false);
    expect(needsResolving("Jordan Reyes")).toBe(false);
  });
});

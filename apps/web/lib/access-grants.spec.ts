import type { GrantDto, RoleDto } from "@workspace/api-client";
import {
  grantsThatCannotOpen,
  lacksOpeningRole,
  roleOpensWorkspace,
} from "./access-grants";

const roles = [
  { key: "viewer", capabilities: ["workspace.view", "finding.view"] },
  { key: "data-reader", capabilities: ["data.query"] },
] as unknown as RoleDto[];

const grant = (
  id: string,
  roleKey: string,
  scopeType: string,
  scopeId: string,
  subjectId = "g1",
) => ({ id, roleKey, scopeType, scopeId, subjectId }) as unknown as GrantDto;

describe("access grants", () => {
  it("knows which roles open a workspace, and trusts unknown ones", () => {
    expect(roleOpensWorkspace(roles, "viewer")).toBe(true);
    expect(roleOpensWorkspace(roles, "data-reader")).toBe(false);
    expect(roleOpensWorkspace(roles, "removed-role")).toBe(true);
  });

  it("flags a pick with no opening role", () => {
    expect(lacksOpeningRole(roles, [])).toBe(false);
    expect(lacksOpeningRole(roles, ["data-reader"])).toBe(true);
    expect(lacksOpeningRole(roles, ["data-reader", "viewer"])).toBe(false);
  });

  it("flags Data reader alone, not with Viewer on the same workspace", () => {
    const alone = [grant("a", "data-reader", "workspace", "ws1")];
    expect([...grantsThatCannotOpen(alone, roles)]).toEqual(["a"]);
    const both = [...alone, grant("b", "viewer", "workspace", "ws1")];
    expect(grantsThatCannotOpen(both, roles).size).toBe(0);
  });

  it("lets a tenant Viewer cover everything of its group", () => {
    const grants = [
      grant("a", "data-reader", "source", "ws1/s1"),
      grant("b", "viewer", "tenant", "t1"),
    ];
    expect(grantsThatCannotOpen(grants, roles).size).toBe(0);
  });

  it("does not let another group's Viewer count", () => {
    const grants = [
      grant("a", "data-reader", "workspace", "ws1", "g1"),
      grant("b", "viewer", "workspace", "ws1", "g2"),
    ];
    expect([...grantsThatCannotOpen(grants, roles)]).toEqual(["a"]);
  });

  it("does not let Viewer on another workspace count", () => {
    const grants = [
      grant("a", "data-reader", "source", "ws1/s1"),
      grant("b", "viewer", "workspace", "ws2"),
    ];
    expect([...grantsThatCannotOpen(grants, roles)]).toEqual(["a"]);
  });

  it("does not warn when a group grant might own the workspace", () => {
    const grants = [
      grant("a", "data-reader", "workspace", "ws1"),
      grant("b", "viewer", "group", "owners"),
    ];
    expect(grantsThatCannotOpen(grants, roles).size).toBe(0);
  });
});

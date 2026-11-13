import * as React from "react";
import type { Namespace, RoleDto, TenantDto, TenantGroupDto } from "@workspace/api-client";
import { GiveAccessDialog } from "@/components/access/give-access-dialog";

const tenant = { id: "t1", name: "Acme" } as unknown as TenantDto;
const workspaces = [{ id: "ws-1", name: "Shop" }] as unknown as Namespace[];
const groups = [
  { id: "sales", name: "sales", path: "/sales", parentId: null },
] as TenantGroupDto[];
const roles = [
  { key: "viewer", title: "Viewer", scopes: ["workspace", "group", "tenant"], capabilities: ["workspace.view"] },
  { key: "tenant-admin", title: "Tenant admin", scopes: ["tenant"], capabilities: ["workspace.view"] },
  { key: "data-reader", title: "Data reader", scopes: ["workspace", "group", "tenant", "source", "asset"], capabilities: ["data.query"] },
] as unknown as RoleDto[];

/** The tenant page's Give access dialog, open, with a fixed tenant. */
export function TenantGiveAccessHarness() {
  return (
    <GiveAccessDialog
      open
      onOpenChange={() => undefined}
      groups={groups}
      roles={roles}
      where={{ kind: "tenant", tenant, workspaces }}
      onAdded={() => undefined}
    />
  );
}

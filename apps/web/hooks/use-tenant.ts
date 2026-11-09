"use client";

import * as React from "react";
import { api, type TenantDto } from "@workspace/api-client";

/**
 * The caller's tenant (`GET /tenant`): name, visitor or not, operator or not,
 * and what they may do across it. Asked once per page and shared by every
 * caller; null until it answers.
 */
let pending: Promise<TenantDto> | null = null;

export function useTenant(): TenantDto | null {
  const [tenant, setTenant] = React.useState<TenantDto | null>(null);
  React.useEffect(() => {
    let active = true;
    if (!pending) {
      pending = api.access.tenantAccessControllerTenant();
      pending.catch(() => {
        pending = null;
      });
    }
    void pending.then(
      (value) => active && setTenant(value),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  return tenant;
}

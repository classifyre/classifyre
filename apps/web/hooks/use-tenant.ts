"use client";

import * as React from "react";
import { api, type TenantDto } from "@workspace/api-client";
import { useIamEnabled } from "@/components/iam-session";

/**
 * The caller's tenant with sign-in (`GET /tenant`): name, visitor or not,
 * operator or not, and what they may do across it. Asked once per page and
 * shared by every caller; null without sign-in or until it answers.
 */
let pending: Promise<TenantDto> | null = null;

export function useTenant(): TenantDto | null {
  const iamEnabled = useIamEnabled();
  const [tenant, setTenant] = React.useState<TenantDto | null>(null);
  React.useEffect(() => {
    if (!iamEnabled) return;
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
  }, [iamEnabled]);
  return tenant;
}

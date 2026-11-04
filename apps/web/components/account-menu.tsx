"use client";

import * as React from "react";
import { Building2, LogOut, UserRound } from "lucide-react";
import { api, type TenantDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useMe } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";

function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

/** The signed-in person, their tenant, and sign-out. Only rendered with sign-in. */
export function AccountMenu() {
  const { t } = useTranslation();
  const me = useMe();
  const [tenant, setTenant] = React.useState<TenantDto | null>(null);

  React.useEffect(() => {
    let active = true;
    void api.access.tenantAccessControllerTenant().then(
      (value) => active && setTenant(value),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  const name = me?.actor.displayName ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-full border border-border text-xs font-semibold"
          aria-label={t("account.menu")}
          data-testid="account-menu"
        >
          {name ? initials(name) : <UserRound className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="space-y-0.5">
          <p className="truncate text-sm font-medium">
            {name ?? t("account.signedIn")}
          </p>
          {tenant && (
            <p className="truncate text-xs font-normal text-muted-foreground">
              {t("account.tenant", { name: tenant.name })}
            </p>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenant?.capabilities.includes("tenant.access.manage") && (
          <DropdownMenuItem asChild>
            <a href="/tenant/">
              <Building2 className="size-4" />
              {t("account.tenantSettings")}
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href="/auth/logout/">
            <LogOut className="size-4" />
            {t("account.signOut")}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import * as React from "react";
import { Building2, LogOut, UserRound } from "lucide-react";
import { api, type TenantDto, type TenantMembershipDto } from "@workspace/api-client";
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
  const [tenants, setTenants] = React.useState<TenantMembershipDto[] | null>(null);

  React.useEffect(() => {
    let active = true;
    void api.access.tenantAccessControllerTenant().then(
      (value) => active && setTenant(value),
      () => undefined,
    );
    // A person in several organizations picks one at sign-in (§12.2); the menu
    // lists the rest so they can switch without typing a URL.
    void api.access
      .tenantAccessControllerTenants()
      .then(
        (value) => active && setTenants(value),
        () => active && setTenants([]),
      );
    return () => {
      active = false;
    };
  }, []);

  const name = me?.actor.displayName ?? null;
  const others = (tenants ?? []).filter((member) => !member.current);
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
        {others.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {t("account.switchTenant")}
            </DropdownMenuLabel>
            {others.map((member) => (
              <DropdownMenuItem key={member.id} asChild>
                <a href={`/auth/login/?tenant=${encodeURIComponent(member.alias)}`}>
                  <Building2 className="size-4" />
                  <span className="truncate">{member.name}</span>
                </a>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
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

"use client";

import * as React from "react";
import { setUnauthorizedHandler } from "@workspace/api-client";

const IamEnabledContext = React.createContext(false);

/** True when people sign in; available everywhere, also outside a workspace. */
export function useIamEnabled(): boolean {
  return React.useContext(IamEnabledContext);
}

/**
 * Sign-in state for the whole app (docs/prd §12.1). With sign-in on, a 401
 * from the API means the session ran out between page loads: renew it once
 * and retry, or go to sign-in. The tokens never reach the browser; only the
 * server can renew.
 */
/** Asked of the API as it is, so a role taken away counts within a minute. */
async function isOperator(): Promise<boolean> {
  try {
    // Plain fetch, not the API client: a 401 here must not re-enter this handler.
    const base = (process.env.NEXT_PUBLIC_API_URL || "/api").replace(/\/+$/, "");
    const response = await fetch(`${base}/platform/me`, { credentials: "same-origin" });
    return response.ok;
  } catch {
    return false;
  }
}

export function IamProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!enabled) return;
    setUnauthorizedHandler(async ({ code }) => {
      // Signed in, but in no tenant, in several or in a suspended one: a new
      // session would be refused the same way, so say so instead of retrying.
      // An operator in no tenant has the Platform page instead.
      if (code === "NO_TENANT" || code === "CHOOSE_TENANT" || code === "TENANT_SUSPENDED") {
        if (code === "NO_TENANT" && (await isOperator())) {
          if (!window.location.pathname.startsWith("/platform")) {
            window.location.assign("/platform/");
          }
          return false;
        }
        window.location.assign(`/auth/no-tenant/?reason=${code}`);
        return false;
      }
      const response = await fetch("/auth/refresh/", {
        method: "POST",
        credentials: "same-origin",
      });
      if (response.status === 204) return true;
      // The identity server is away for a moment: the request fails, the
      // session stays, and the next one tries again.
      if (response.status === 503) return false;
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.assign(
        `/auth/login/?returnTo=${encodeURIComponent(returnTo)}`,
      );
      return false;
    });
    return () => setUnauthorizedHandler(null);
  }, [enabled]);

  return (
    <IamEnabledContext.Provider value={enabled}>{children}</IamEnabledContext.Provider>
  );
}

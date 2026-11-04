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
export function IamProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!enabled) return;
    setUnauthorizedHandler(async () => {
      const response = await fetch("/auth/refresh/", {
        method: "POST",
        credentials: "same-origin",
      });
      if (response.status === 204) return true;
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

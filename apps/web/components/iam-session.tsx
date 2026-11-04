"use client";

import * as React from "react";
import { setUnauthorizedHandler } from "@workspace/api-client";

/**
 * With sign-in on, a 401 from the API means the session ran out between page
 * loads: renew it once and retry, or go to sign-in (docs/prd §12.1). The
 * tokens themselves never reach the browser; only the server can renew.
 */
export function IamSession({ enabled }: { enabled: boolean }) {
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
  return null;
}

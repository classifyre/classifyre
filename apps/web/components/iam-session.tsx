"use client";

import * as React from "react";
import {
  namespaceSlugFromPath,
  setUnauthorizedHandler,
} from "@workspace/api-client";

const IamConsoleContext = React.createContext(false);

/**
 * True when the realm's identity console is reachable through the app
 * (`iam.realmConsole`): operators get links to it, via `/auth/console/`.
 */
export function useIamConsole(): boolean {
  return React.useContext(IamConsoleContext);
}

/**
 * Sign-in state for the whole app (docs/prd §12.1). A 401 from the API means the session ran out between page loads: renew it once
 * and retry, or go to sign-in. The tokens never reach the browser; only the
 * server can renew.
 */
/** Asked of the API as it is, so a role taken away counts within a minute. */
async function isOperator(): Promise<boolean> {
  try {
    // Plain fetch, not the API client: a 401 here must not re-enter this handler.
    const base = (process.env.NEXT_PUBLIC_API_URL || "/api").replace(
      /\/+$/,
      "",
    );
    const response = await fetch(`${base}/platform/me`, {
      credentials: "same-origin",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Whether the page is a workspace the visitor may read (a public one). A
 * visitor has no session to renew: inside a public workspace, a request for
 * something closed to them (settings, activity, SQL, …) simply fails and the
 * page goes on; only a workspace closed to them sends them to sign in.
 */
const publicSlugs = new Map<string, Promise<boolean>>();
function readsPublicWorkspace(): Promise<boolean> {
  const slug = namespaceSlugFromPath(window.location.pathname);
  // Outside a workspace (the directory) the page itself decides.
  if (!slug) return Promise.resolve(true);
  let known = publicSlugs.get(slug);
  if (!known) {
    known = (async () => {
      try {
        const base = (process.env.NEXT_PUBLIC_API_URL || "/api").replace(
          /\/+$/,
          "",
        );
        // Plain fetch, not the API client: no re-entry into this handler.
        const response = await fetch(`${base}/namespaces`, {
          credentials: "same-origin",
        });
        if (!response.ok) return false;
        const listed = (await response.json()) as Array<{ slug?: string }>;
        return listed.some((workspace) => workspace.slug === slug);
      } catch {
        return false;
      }
    })();
    publicSlugs.set(slug, known);
  }
  return known;
}

export function IamProvider({
  console: consoleEnabled = false,
  children,
}: {
  console?: boolean;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    setUnauthorizedHandler(async ({ code }) => {
      // Signed in, but in no tenant, in several or in a suspended one: a new
      // session would be refused the same way, so say so instead of retrying.
      // An operator in no tenant has the Platform page instead.
      if (
        code === "NO_TENANT" ||
        code === "CHOOSE_TENANT" ||
        code === "TENANT_SUSPENDED" ||
        code === "TENANT_DELETED" ||
        code === "TENANT_REPLACED"
      ) {
        if (code === "NO_TENANT" && (await isOperator())) {
          if (!window.location.pathname.startsWith("/platform")) {
            window.location.assign("/platform/");
          }
          return false;
        }
        window.location.assign(`/auth/no-tenant/?reason=${code}`);
        return false;
      }
      // Not signed in at all (a visitor): nothing to renew. In a public
      // workspace the refused request just fails — never an automatic trip
      // to the sign-in page; **Sign in** is in the header for that.
      if (code === "SIGN_IN_REQUIRED" && (await readsPublicWorkspace())) {
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
  }, []);

  return (
    <IamConsoleContext.Provider value={consoleEnabled}>
      {children}
    </IamConsoleContext.Provider>
  );
}

"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { nsPath } from "@/lib/ns-path";
import { RETURN_TO_PARAM, safeReturnTo } from "@/lib/return-to";

/**
 * Leave the page the way the person came: to `?returnTo=` when it names an
 * address in the app, else back through the browser history, else to
 * `fallback` (a namespace-relative path).
 */
export function useGoBack(fallback: string): { goBack: () => void; returnTo: string | null } {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = safeReturnTo(params?.get(RETURN_TO_PARAM) ?? null);
  const goBack = React.useCallback(() => {
    if (returnTo) {
      router.push(returnTo);
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(nsPath(fallback));
  }, [returnTo, router, fallback]);
  return { goBack, returnTo };
}

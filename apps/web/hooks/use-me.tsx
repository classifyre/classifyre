"use client";

import * as React from "react";
import {
  api,
  getActiveNamespaceSlug,
  type MeResponseDto,
} from "@workspace/api-client";

/**
 * Who the current person is in the active workspace and what they may do
 * there (`GET /<workspace>/me`, docs/prd §12.3). Without sign-in every
 * capability is present, so hiding controls by capability changes nothing.
 * Fetched once per workspace and shared by every caller.
 */
const cache = new Map<string, Promise<MeResponseDto>>();

export function useMe(): MeResponseDto | null {
  const slug = getActiveNamespaceSlug();
  const [me, setMe] = React.useState<MeResponseDto | null>(null);

  React.useEffect(() => {
    const key = slug ?? "";
    let active = true;
    let pending = cache.get(key);
    if (!pending) {
      pending = api.identity.meControllerMe();
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
    }
    void pending.then(
      (value) => active && setMe(value),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [slug]);

  return me;
}

/**
 * True when the person may do `capability` here. False until `/me` has
 * answered: a control that appears late beats one that is offered and then
 * refused.
 */
export function useCan(capability: string): boolean {
  const me = useMe();
  return me ? (me.capabilities as string[]).includes(capability) : false;
}

/**
 * Renders its children only when the person holds the capability. The API
 * stays the authority; this only keeps controls away from people who would
 * be refused.
 */
export function Can({
  capability,
  children,
  fallback = null,
}: {
  capability: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return <>{useCan(capability) ? children : fallback}</>;
}

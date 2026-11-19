"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNamespace } from "@/components/namespace-provider";

function Redirect({
  to,
  keepQuery,
  set,
}: {
  to: string;
  keepQuery: boolean;
  set?: Record<string, string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { nsHref } = useNamespace();
  React.useEffect(() => {
    const params = new URLSearchParams(
      keepQuery ? searchParams.toString() : "",
    );
    for (const [key, value] of Object.entries(set ?? {}))
      params.set(key, value);
    const query = params.toString();
    router.replace(`${nsHref(to)}${query ? `?${query}` : ""}`);
  }, [keepQuery, nsHref, router, searchParams, set, to]);
  return null;
}

/**
 * A page that moved: replace it with its new place in the workspace, built
 * from the same namespace context every other link in the subtree uses (so
 * on the client, not as a server redirect). `keepQuery` carries the old
 * address's query along; `set` adds or overrides keys of it.
 */
export function NamespaceRedirect(props: {
  to: string;
  keepQuery?: boolean;
  set?: Record<string, string>;
}) {
  return (
    <React.Suspense>
      <Redirect
        to={props.to}
        keepQuery={props.keepQuery ?? false}
        set={props.set}
      />
    </React.Suspense>
  );
}

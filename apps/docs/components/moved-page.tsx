import Link from "next/link";

import { RedirectClient } from "@/app/flow/investigations/[[...slug]]/redirect-client";

/**
 * A page that used to exist and now lives somewhere else.
 *
 * The docs are a static export, so there is no server to issue a 301. These
 * stubs are the substitute: an indexable-but-noindex page that names the new
 * location and sends the reader there. Deleting the old URL outright would turn
 * every existing link, bookmark and search result into a 404.
 */
export function MovedPage({
  target,
  title,
  children,
}: {
  target: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-start justify-center gap-4 px-6 py-16">
      <RedirectClient target={target} />
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
        This page moved
      </p>
      <h1 className="font-serif text-2xl font-black uppercase tracking-[0.06em]">
        {title}
      </h1>
      <p className="text-muted-foreground">{children}</p>
      <Link
        href={target}
        className="border-2 border-border bg-accent px-4 py-2 font-mono text-sm font-bold uppercase tracking-[0.1em] text-accent-foreground"
      >
        Go to {target}
      </Link>
    </main>
  );
}

import type { Metadata } from "next";

/**
 * `/de/download` moved to `/de/get` — the German twin of the English
 * redirect stub in `app/(en)/download/page.tsx`. Same static-export trick:
 * neither redirects nor rewrites exist for `output: "export"`, so a meta
 * refresh plus `location.replace` is what a static host can honour.
 */
const TARGET = "/de/get/";

export const metadata: Metadata = {
  title: "Verschoben nach /de/get",
  alternates: {
    canonical: TARGET,
    languages: {
      en: "/download/",
      de: "/de/download/",
      "x-default": "/download/",
    },
  },
  // Keep it out of the index: the destination is the page that should rank.
  robots: { index: false, follow: true },
};

export default function GermanDownloadRedirectPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-24 sm:px-6">
      {/* Hoisted into <head> by React. Written here rather than through the
          metadata API because that one can only emit <meta name="...">, and a
          refresh only works as http-equiv. This is the no-JS path. */}
      <meta httpEquiv="refresh" content={`0; url=${TARGET}`} />
      {/* And this is the fast path, before paint, for everyone else. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `location.replace(${JSON.stringify(TARGET)});`,
        }}
      />
      <h1 className="font-serif text-2xl font-black uppercase tracking-[0.04em]">
        Diese Seite ist umgezogen
      </h1>
      <p className="text-base leading-7 text-muted-foreground">
        Classifyre ist jetzt ein einzelnes Docker-Image statt eines
        Desktop-Downloads. Sie werden weitergeleitet zu{" "}
        <a href={TARGET} className="underline underline-offset-4">
          Classifyre holen
        </a>
        .
      </p>
    </main>
  );
}

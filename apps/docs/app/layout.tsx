import type { Metadata } from "next";
import {
  Archivo_Black,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  League_Gothic,
} from "next/font/google";
import Script from "next/script";
import type { PageMapItem } from "nextra";
import { Banner, Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { Footer, Layout, Navbar } from "nextra-theme-docs";

import { Badge } from "@workspace/ui/components";
import { softwareVersionLabel } from "@workspace/ui/lib/software-version";
import { getAllSourceDocs } from "@workspace/schemas/source-docs";
import { getAllDetectorDocs } from "@workspace/schemas/detector-docs";

import {
  buildDocsSiteUrl,
  generateDocsCollectionSchema,
  generateDocsSiteSchema,
  resolveDocsBasePath,
  safeJsonLdStringify,
} from "@/lib/seo";

import "@workspace/ui/globals.css";
import "@workspace/ui/nextra-overrides.css";
import "nextra-theme-docs/style.css";

const fontSerif = Archivo_Black({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-serif",
});

const fontSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

const fontHero = League_Gothic({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-hero",
});

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "/ingest";

const siteOrigin = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://classifyre.local"
).replace(/\/$/, "");
const docsBasePath = resolveDocsBasePath();
const docsSiteUrl = buildDocsSiteUrl(siteOrigin, docsBasePath);

function isFolderPageMapItem(
  item: PageMapItem,
): item is Extract<PageMapItem, { children: PageMapItem[] }> {
  return "children" in item && Array.isArray(item.children);
}

function isMetaPageMapItem(
  item: PageMapItem,
): item is Extract<PageMapItem, { data: Record<string, unknown> }> {
  return "data" in item;
}

function isNamedPageMapItem(
  item: PageMapItem,
): item is Extract<PageMapItem, { name: string; route: string }> {
  return (
    "name" in item &&
    typeof item.name === "string" &&
    typeof item.route === "string"
  );
}

function buildSourcesFolder(
  baseItem: {
    name: string;
    route: string;
    frontMatter?: unknown;
    title?: unknown;
  },
  nestedChildren: PageMapItem[],
): PageMapItem {
  const sourceDocs = getAllSourceDocs();
  const generatedSourceRoutes = new Set(
    sourceDocs.map((source) => `/sources/${source.slug}`),
  );

  const filteredChildren = nestedChildren.filter((child) => {
    if (!isNamedPageMapItem(child)) {
      return true;
    }

    if (child.name === "[sourceType]") {
      return false;
    }

    return !generatedSourceRoutes.has(child.route);
  });

  const initialMeta =
    filteredChildren[0] && isMetaPageMapItem(filteredChildren[0])
      ? filteredChildren[0].data
      : {};
  const childrenWithoutMeta =
    filteredChildren[0] && isMetaPageMapItem(filteredChildren[0])
      ? filteredChildren.slice(1)
      : filteredChildren;

  const mergedMeta: Record<string, unknown> = {
    ...initialMeta,
    "[sourceType]": { display: "hidden" },
  };

  for (const source of sourceDocs) {
    mergedMeta[source.slug] = {
      title: source.label,
    };
  }

  const generatedChildren: PageMapItem[] = sourceDocs.map((source) => ({
    name: source.slug,
    route: `/sources/${source.slug}`,
    title: source.label,
  }));

  return {
    name: baseItem.name,
    route: baseItem.route,
    title: typeof baseItem.title === "string" ? baseItem.title : "Sources",
    ...(baseItem.frontMatter ? { frontMatter: baseItem.frontMatter } : {}),
    children: [
      {
        data: mergedMeta,
      },
      ...childrenWithoutMeta,
      ...generatedChildren,
    ],
  } as PageMapItem;
}

function buildDetectorsFolder(
  baseItem: {
    name: string;
    route: string;
    frontMatter?: unknown;
    title?: unknown;
  },
  nestedChildren: PageMapItem[],
): PageMapItem {
  const detectorDocs = getAllDetectorDocs();
  const generatedDetectorRoutes = new Set(
    detectorDocs.map((d) => `/detectors/${d.slug}`),
  );

  const filteredChildren = nestedChildren.filter((child) => {
    if (!isNamedPageMapItem(child)) return true;
    if (child.name === "[detectorType]") return false;
    return !generatedDetectorRoutes.has(child.route);
  });

  const initialMeta =
    filteredChildren[0] && isMetaPageMapItem(filteredChildren[0])
      ? filteredChildren[0].data
      : {};
  const childrenWithoutMeta =
    filteredChildren[0] && isMetaPageMapItem(filteredChildren[0])
      ? filteredChildren.slice(1)
      : filteredChildren;

  const mergedMeta: Record<string, unknown> = {
    ...initialMeta,
    "[detectorType]": { display: "hidden" },
  };

  for (const detector of detectorDocs) {
    mergedMeta[detector.slug] = { title: detector.label };
  }

  const generatedChildren: PageMapItem[] = detectorDocs.map((detector) => ({
    name: detector.slug,
    route: `/detectors/${detector.slug}`,
    title: detector.label,
  }));

  return {
    name: baseItem.name,
    route: baseItem.route,
    title: typeof baseItem.title === "string" ? baseItem.title : "Detectors",
    ...(baseItem.frontMatter ? { frontMatter: baseItem.frontMatter } : {}),
    children: [
      { data: mergedMeta },
      ...childrenWithoutMeta,
      ...generatedChildren,
    ],
  } as PageMapItem;
}

function withSourceSidebarChildren(pageMap: PageMapItem[]): PageMapItem[] {
  return pageMap.map((item) => {
    if (isFolderPageMapItem(item)) {
      const nestedChildren = withSourceSidebarChildren(item.children);

      if (item.route === "/sources") {
        return buildSourcesFolder(
          {
            name: item.name,
            route: item.route,
            ...(isNamedPageMapItem(item) && "frontMatter" in item
              ? { frontMatter: item.frontMatter }
              : {}),
            ...(isNamedPageMapItem(item) && "title" in item
              ? { title: item.title }
              : {}),
          },
          nestedChildren,
        );
      }

      if (item.route === "/detectors") {
        return buildDetectorsFolder(
          {
            name: item.name,
            route: item.route,
            ...(isNamedPageMapItem(item) && "frontMatter" in item
              ? { frontMatter: item.frontMatter }
              : {}),
            ...(isNamedPageMapItem(item) && "title" in item
              ? { title: item.title }
              : {}),
          },
          nestedChildren,
        );
      }

      return { ...item, children: nestedChildren };
    }

    if (isNamedPageMapItem(item) && item.route === "/sources") {
      return buildSourcesFolder(
        {
          name: item.name,
          route: item.route,
          ...("frontMatter" in item ? { frontMatter: item.frontMatter } : {}),
          ...("title" in item ? { title: item.title } : {}),
        },
        [],
      );
    }

    if (isNamedPageMapItem(item) && item.route === "/detectors") {
      return buildDetectorsFolder(
        {
          name: item.name,
          route: item.route,
          ...("frontMatter" in item ? { frontMatter: item.frontMatter } : {}),
          ...("title" in item ? { title: item.title } : {}),
        },
        [],
      );
    }

    return item;
  });
}

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: "Classifyre Docs",
    template: "%s | Classifyre Docs",
  },
  description:
    "Documentation for the Classifyre platform: architecture notes, deployment patterns, and practical implementation guides.",
  keywords: [
    "classifyre",
    "documentation",
    "platform engineering",
    "security scanning",
    "software architecture",
  ],
  alternates: {
    canonical: docsBasePath || "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    title: "Classifyre Docs",
    description:
      "Documentation for the Classifyre platform: architecture notes, deployment patterns, and practical implementation guides.",
    url: docsSiteUrl,
    siteName: "Classifyre Docs",
  },
  twitter: {
    card: "summary_large_image",
    title: "Classifyre Docs",
    description:
      "Documentation for the Classifyre platform: architecture notes, deployment patterns, and practical implementation guides.",
  },
};

const banner = (
  <Banner storageKey="classifyre-docs-banner">
    Unified docs shell with shared Classifyre tokens and acid-green highlight
    accents.
  </Banner>
);

const navbar = (
  <Navbar
    logo={
      <div className="flex items-center gap-3">
        <Badge
          variant="secondary"
          className="rounded-[4px] border-2 border-border bg-accent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-accent-foreground"
        >
          Docs
        </Badge>
        <div className="flex items-center gap-2">
          <span className="font-serif text-xl font-black uppercase tracking-[0.08em]">
            Classifyre
          </span>
          <span className="rounded-[4px] border border-border/70 bg-background/80 px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
            {softwareVersionLabel}
          </span>
        </div>
      </div>
    }
    logoLink
  />
);

const footer = (
  <Footer className="border-t border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
    Classifyre Docs. Static export is bundled under{" "}
    <code>{docsBasePath || "/"}</code> in production.
  </Footer>
);

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pageMap = withSourceSidebarChildren(await getPageMap());

  const docsSchema = generateDocsSiteSchema(docsSiteUrl);
  const collectionSchema = generateDocsCollectionSchema(docsSiteUrl);

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
        <link rel="canonical" href={docsSiteUrl} />
        <link rel="dns-prefetch" href="//fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
          crossOrigin=""
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(docsSchema),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(collectionSchema),
          }}
        />
      </Head>
      <body
        className={`${fontSerif.variable} ${fontSans.variable} ${fontMono.variable} ${fontHero.variable} font-sans antialiased`}
      >
        {POSTHOG_KEY && (
          <Script id="posthog-init" strategy="afterInteractive">
            {`
              !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
              posthog.init('${POSTHOG_KEY}', {
                api_host: '${POSTHOG_HOST}',
                ui_host: 'https://us.posthog.com',
                capture_pageview: true,
                capture_pageleave: true,
                person_profiles: 'identified_only',
              });
            `}
          </Script>
        )}
        <Layout
          banner={banner}
          navbar={navbar}
          footer={footer}
          pageMap={pageMap}
          docsRepositoryBase="https://github.com/Ostap-Bender/unstructured/tree/main/apps/docs"
          sidebar={{
            defaultMenuCollapseLevel: 2,
            defaultOpen: true,
            toggleButton: true,
          }}
          nextThemes={{
            attribute: "class",
            defaultTheme: "dark",
            disableTransitionOnChange: true,
            storageKey: "classifyre-docs-theme",
          }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}

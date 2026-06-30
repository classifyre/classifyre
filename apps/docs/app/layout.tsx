import type { Metadata } from "next";
import {
  Archivo_Black,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  League_Gothic,
} from "next/font/google";
import type { PageMapItem } from "nextra";
import { Banner, Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { Footer, Layout, Navbar } from "nextra-theme-docs";

import { softwareVersionLabel } from "@workspace/ui/lib/software-version";
import { getAllSourceDocs } from "@workspace/schemas/source-docs";

import {
  buildDocsSiteUrl,
  generateDocsCollectionSchema,
  generateDocsSiteSchema,
  resolveDocsBasePath,
  safeJsonLdStringify,
} from "@/lib/seo";
import { PostHogProvider } from "./providers";

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
      <div className="flex items-center gap-2">
        <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg">
          <img
            src="/clasifyre_icon.png"
            width={32}
            height={32}
            alt="Classifyre"
            className="size-full object-cover"
          />
        </div>
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-serif font-bold">Classifyre Docs</span>
          <span className="truncate font-mono text-[10px] text-muted-foreground">
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
    Classifyre Docs
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
        <PostHogProvider>
          <Layout
            // banner={banner}
            navbar={navbar}
            footer={footer}
            pageMap={pageMap}
            docsRepositoryBase="https://github.com/classifyre/classifyre/tree/develop/apps/docs"
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
        </PostHogProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import {
  Archivo_Black,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  League_Gothic,
} from "next/font/google";
import { Banner, Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { Footer, Layout, Navbar } from "nextra-theme-docs";

import { Badge } from "@workspace/ui/components";

import {
  generateBlogSchema,
  generateBlogSiteSchema,
  generateOrganizationSchema,
  normalizeSiteUrl,
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

const siteUrl = normalizeSiteUrl(
  process.env.NEXT_PUBLIC_BLOG_SITE_URL ?? "https://blog.classifyre.local",
);

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Classifyre Engineering Blog",
    template: "%s | Classifyre Engineering Blog",
  },
  description:
    "Long-form engineering writing: architecture analysis, workflow design, and delivery tradeoffs.",
  keywords: [
    "software engineering",
    "architecture",
    "delivery",
    "technical leadership",
    "platform engineering",
  ],
  alternates: {
    canonical: "/",
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
    title: "Classifyre Engineering Blog",
    description:
      "Long-form engineering writing: architecture analysis, workflow design, and delivery tradeoffs.",
    url: siteUrl,
    siteName: "Classifyre Engineering Blog",
  },
  twitter: {
    card: "summary_large_image",
    title: "Classifyre Engineering Blog",
    description:
      "Long-form engineering writing: architecture analysis, workflow design, and delivery tradeoffs.",
  },
};

const banner = (
  <Banner storageKey="classifyre-blog-banner">
    Engineering notes with Classifyre&apos;s shared brutalist token system and docs
    shell.
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
          Blog
        </Badge>
        <span className="font-serif text-xl font-black uppercase tracking-[0.08em]">
          Classifyre
        </span>
      </div>
    }
    logoLink
  />
);

const footer = (
  <Footer className="border-t border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
    Classifyre Engineering Blog. Nextra docs shell with archive pages and MDX
    posts.
  </Footer>
);

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pageMap = await getPageMap();

  const websiteSchema = generateBlogSiteSchema(siteUrl);
  const organizationSchema = generateOrganizationSchema(siteUrl);
  const blogSchema = generateBlogSchema(siteUrl);

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
        <link rel="dns-prefetch" href="//fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
          crossOrigin=""
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(websiteSchema),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(organizationSchema),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(blogSchema),
          }}
        />
      </Head>
      <body
        className={`${fontSerif.variable} ${fontSans.variable} ${fontMono.variable} ${fontHero.variable} font-sans antialiased`}
      >
        <Layout
          banner={banner}
          navbar={navbar}
          footer={footer}
          pageMap={pageMap}
          docsRepositoryBase="https://github.com/Ostap-Bender/unstructured/tree/main/apps/blog"
          sidebar={{
            defaultMenuCollapseLevel: 2,
            defaultOpen: true,
            toggleButton: true,
          }}
          nextThemes={{
            attribute: "class",
            defaultTheme: "dark",
            disableTransitionOnChange: true,
            storageKey: "classifyre-blog-theme",
          }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}

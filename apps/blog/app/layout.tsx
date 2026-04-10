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

import {
  Badge,
  Button,
  SourceIcon,
  ThemeToggle,
} from "@workspace/ui/components";

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
    default: "Classifyre",
    template: "%s | Classifyre",
  },
  description:
    "Detect, classify, and label data across databases, lakehouses, collaboration tools, analytics systems, and public content.",
  keywords: [
    "data classification",
    "data labeling",
    "data detection",
    "open source data governance",
    "custom detectors",
    "kubernetes deployment",
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
    title: "Classifyre",
    description:
      "Detect, classify, and label data across databases, lakehouses, collaboration tools, analytics systems, and public content.",
    url: siteUrl,
    siteName: "Classifyre",
  },
  twitter: {
    card: "summary_large_image",
    title: "Classifyre",
    description:
      "Detect, classify, and label data across databases, lakehouses, collaboration tools, analytics systems, and public content.",
  },
};

const banner = (
  <Banner storageKey="classifyre-blog-banner">
    Open-source core, acid-green signal, and deployment paths from one Docker
    command to Kubernetes core and enterprise rollout.
  </Banner>
);

const navbar = (
  <Navbar
    logoLink="/"
    logo={
      <div className="flex items-center gap-3">
        <span className="font-serif text-xl font-black uppercase tracking-[0.08em]">
          Classifyre
        </span>
      </div>
    }
    className="classifyre-blog-navbar border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
  >
    <div className="hidden items-center gap-2 lg:flex">
      <Button asChild variant="link">
        <a href="https://classifyre.com/blog">Blog</a>
      </Button>
      <Button asChild variant="link">
        <a href="https://docs.classifyre.com/" target="_blank" rel="noreferrer">
          Documentation
        </a>
      </Button>
      <Button
        asChild
        className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
      >
        <a href="https://demo.classifyre.com/" target="_blank" rel="noreferrer">
          Demo
        </a>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        asChild
        className="rounded-[4px] border-2 border-transparent hover:border-border"
      >
        <a
          href="https://github.com/classifyre-com/classifyre"
          target="_blank"
          rel="noreferrer"
          aria-label="Classifyre on GitHub"
        >
          <SourceIcon
            source="github"
            size="sm"
            className="[&_svg]:text-current"
          />
        </a>
      </Button>
      <ThemeToggle />
    </div>
  </Navbar>
);

const footer = (
  <Footer className="relative left-1/2 w-screen max-w-none -translate-x-1/2 border-t-2 border-white/20 bg-black px-0 py-0 text-sm text-white">
    <div className="grid w-full lg:grid-cols-3">
      <div className="border-b-2 border-white/20 px-6 py-8 text-left lg:border-b-0 lg:border-r-2 lg:px-8">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Badge
              variant="secondary"
              className="rounded-[4px] border-2 border-white/20 bg-accent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-black"
            >
              Classifyre
            </Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/60">
              Detect. Classify. Label.
            </span>
          </div>
          <p className="max-w-md text-base leading-7 text-white/78">
            Open-source detection, classification, and labeling for the systems
            you already run, with a clean path from local evaluation to governed
            enterprise rollout.
          </p>
        </div>
      </div>

      <div className="border-b-2 border-white/20 px-6 py-8 text-left lg:border-b-0 lg:border-r-2 lg:px-8">
        <div className="space-y-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/60">
            Links
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <a
              href="https://docs.classifyre.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-between rounded-sm border border-white/20 bg-transparent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-white shadow-xs transition-all hover:bg-accent/10 hover:text-white"
            >
              Docs
              <span>01</span>
            </a>
            <a
              href="https://demo.classifyre.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-between rounded-sm border border-white/20 bg-transparent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-white shadow-xs transition-all hover:bg-accent/10 hover:text-white"
            >
              Demo
              <span>02</span>
            </a>
            <a
              href="https://github.com/classifyre-com/classifyre"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-between rounded-sm border border-white/20 bg-transparent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-white shadow-xs transition-all hover:bg-accent/10 hover:text-white"
            >
              GitHub
              <span>03</span>
            </a>
            <a
              href="https://docs.classifyre.com/sources/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-between rounded-sm border border-white/20 bg-transparent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-white shadow-xs transition-all hover:bg-accent/10 hover:text-white"
            >
              Sources
              <span>04</span>
            </a>
          </div>
        </div>
      </div>

      <div className="px-6 py-8 text-left lg:px-8">
        <div className="space-y-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/60">
            Delivery Path
          </div>
          <div className="space-y-3">
            <div className="border border-white/20 px-4 py-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                Evaluate
              </div>
              <p className="mt-2 text-white/78">
                One Docker command. One public port. Immediate product
                validation.
              </p>
            </div>
            <div className="border border-white/20 px-4 py-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                Operate
              </div>
              <p className="mt-2 text-white/78">
                Demo the release, run real scans, and move into enterprise
                Kubernetes when governance and SLA matter.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
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
          // banner={banner} //Enable when needed
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
            defaultTheme: "light",
            disableTransitionOnChange: true,
            storageKey: "classifyre-blog-theme-v2",
          }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}

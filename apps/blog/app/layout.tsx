import type {Metadata} from "next";
import {Archivo_Black, IBM_Plex_Mono, IBM_Plex_Sans, League_Gothic,} from "next/font/google";
import {Head} from "nextra/components";
import {getPageMap} from "nextra/page-map";
import {Footer, Layout, Navbar} from "nextra-theme-docs";

import {CookieConsentBanner, SiteFooter} from "@workspace/ui/components";

import {
    generateBlogSchema,
    generateBlogSiteSchema,
    generateOrganizationSchema,
    normalizeSiteUrl,
    safeJsonLdStringify,
} from "@/lib/seo";
import {SiteNav} from "@/components/site-nav";
import {routes} from "@/lib/site";
import {GoogleAnalytics} from "./google-analytics";
import {PostHogProvider} from "./providers";

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


const navbar = (
    <Navbar
        logoLink="/"
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
                    <span className="truncate font-serif font-bold">Classifyre</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
            Investigation Platform
</span>
                </div>
            </div>
        }
        className="classifyre-blog-navbar border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
        <SiteNav/>
    </Navbar>
);

const footer = (
    <Footer className="classifyre-site-footer">
        <SiteFooter/>
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
            <link rel="dns-prefetch" href="//fonts.googleapis.com"/>
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
        <GoogleAnalytics/>
        <PostHogProvider>
            <Layout
                // banner={banner} //Enable when needed
                navbar={navbar}
                footer={footer}
                pageMap={pageMap}
                docsRepositoryBase="https://github.com/classifyre/classifyre/tree/main/apps/blog"
                // Marketing pages, not docs: no "edit this page" and no
                // feedback issue link under every post.
                editLink={null}
                feedback={{content: null}}
                sidebar={{
                    defaultMenuCollapseLevel: 2,
                    defaultOpen: true,
                    toggleButton: true,
                }}
                nextThemes={{
                    attribute: "class",
                    defaultTheme: "system",
                    disableTransitionOnChange: true,
                    storageKey: "classifyre-blog-theme-v2",
                }}
            >
                {children}
            </Layout>
            {/* Shown only where consent is legally required (EEA/UK/CH, by time
                zone) and only until answered; the analytics providers above
                stay inert until it is. */}
            <CookieConsentBanner policyHref={`${routes.privacy}/`}/>
        </PostHogProvider>
        </body>
        </html>
    );
}

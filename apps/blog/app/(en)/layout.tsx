import type {Metadata} from "next";
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
import {blogFontClassName} from "@/components/blog-fonts";
import {LocaleRedirect, LocaleRedirectHeadScript} from "@/components/locale-redirect";
import {SiteNav} from "@/components/site-nav";
import {routes} from "@/lib/site";
import {GoogleAnalytics} from "../google-analytics";
import {PostHogProvider} from "../providers";

import "@workspace/ui/globals.css";
import "@workspace/ui/nextra-overrides.css";
import "nextra-theme-docs/style.css";

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
        languages: {
            en: "/",
            de: "/de/",
            "x-default": "/",
        },
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
    // The German tree lives at `app/de/…`, so the raw page map contains a
    // top-level `/de` folder. The English chrome must not list it in the
    // navbar or sidebar — the German layout serves `getPageMap("/de")` and
    // its own `_meta` files instead.
    const pageMap = (await getPageMap()).filter(
        (item) => !("route" in item && item.route === "/de"),
    );

    const websiteSchema = generateBlogSiteSchema(siteUrl);
    const organizationSchema = generateOrganizationSchema(siteUrl);
    const blogSchema = generateBlogSchema(siteUrl);

    return (
        <html lang="en" dir="ltr" suppressHydrationWarning>
        <Head>
            {/* Static export has no middleware: this is what moves a German
                browser from `/` to `/de/` before first paint. `/de/…` URLs
                and explicit cookie choices are never touched. */}
            <LocaleRedirectHeadScript/>
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
            className={blogFontClassName}
        >
        <GoogleAnalytics/>
        {/* Same redirect rule for client-side navigation after hydration. */}
        <LocaleRedirect/>
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
                // No search on the blog: search lives on the docs site.
                search={null}
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

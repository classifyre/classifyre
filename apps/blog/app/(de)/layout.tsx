import type {Metadata} from "next";
import {Head} from "nextra/components";
import {getPageMap} from "nextra/page-map";
import {Footer, Layout, Navbar} from "nextra-theme-docs";

import {CookieConsentBanner, SiteFooter} from "@workspace/ui/components";

import deTranslations from "@/i18n/de.json";
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
import {showcaseUrlFor} from "@/lib/site";
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
    description: deTranslations.site.description,
    alternates: {
        canonical: "/de/",
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
        description: deTranslations.site.description,
        url: `${siteUrl}/de/`,
        siteName: "Classifyre",
        locale: "de_DE",
    },
    twitter: {
        card: "summary_large_image",
        title: "Classifyre",
        description: deTranslations.site.description,
    },
};

const navbar = (
    <Navbar
        logoLink="/de/"
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
            {deTranslations.footer.tagline}
</span>
                </div>
            </div>
        }
        className="classifyre-blog-navbar border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
        <SiteNav locale="de"/>
    </Navbar>
);

const footer = (
    <Footer className="classifyre-site-footer">
        <SiteFooter origin="/de" copy={deTranslations.footer} showcaseHref={showcaseUrlFor("de")}/>
    </Footer>
);

export default async function GermanRootLayout({
                                                   children,
                                               }: Readonly<{
    children: React.ReactNode;
}>) {
    const pageMap = await getPageMap("/de");

    const websiteSchema = generateBlogSiteSchema(siteUrl, "de");
    const organizationSchema = generateOrganizationSchema(siteUrl, "de");
    const blogSchema = generateBlogSchema(siteUrl, "de");

    return (
        <html lang="de" dir="ltr" suppressHydrationWarning>
        <Head>
            {/* No-op on `/de/…` URLs by construction; kept so both locale
                layouts emit the same head shape. */}
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
        <LocaleRedirect/>
        <PostHogProvider>
            <Layout
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
                toc={{title: deTranslations.chrome.tocTitle}}
                nextThemes={{
                    attribute: "class",
                    defaultTheme: "system",
                    disableTransitionOnChange: true,
                    storageKey: "classifyre-blog-theme-v2",
                }}
            >
                {children}
            </Layout>
            <CookieConsentBanner
                policyHref="/de/privacy/"
                copy={deTranslations.cookie}
            />
        </PostHogProvider>
        </body>
        </html>
    );
}

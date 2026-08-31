import type { Metadata } from "next";
import {
  Archivo_Black,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  League_Gothic,
} from "next/font/google";

import "@workspace/ui/globals.css";
import { Providers } from "@/components/providers";
import { ANALYTICS_CONFIG_PATH } from "@/lib/analytics-config";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

// Desktop is a static export with no server to serve the runtime config, and
// ships without analytics anyway.
const isDesktopBuild = process.env.DESKTOP_BUILD === "true";

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

const siteUrl =
  process.env.PUBLIC_BASE_URL ??
  process.env.SITEMAP_BASE_URL ??
  "https://classifyre.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    template: `%s | ${translate(enTranslations, "app.name")}`,
    default: translate(enTranslations, "seo.site.title"),
  },
  description: translate(enTranslations, "seo.site.description"),
  keywords: translate(enTranslations, "seo.site.keywords").split(", "),
  authors: [{ name: "Classifyre", url: siteUrl }],
  creator: "Classifyre",
  publisher: "Classifyre",
  category: "Technology",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: translate(enTranslations, "app.name"),
    title: translate(enTranslations, "seo.site.ogTitle"),
    description: translate(enTranslations, "seo.site.ogDescription"),
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: translate(enTranslations, "seo.site.twitterTitle"),
    description: translate(enTranslations, "seo.site.twitterDescription"),
    creator: "@classifyre",
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
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${fontSerif.variable} ${fontSans.variable} ${fontMono.variable} ${fontHero.variable} font-sans antialiased`}
      >
        {/*
          Analytics config resolved per-deployment by Helm. Loaded synchronously
          so PostHog/gtag are configured before React hydrates. See
          `lib/analytics-config.ts` for why build-time env vars can't be used.
        */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- deliberate:
            a small same-origin script that must run before hydration so the
            PostHog provider sees its config on first effect. */}
        {!isDesktopBuild && <script src={ANALYTICS_CONFIG_PATH} />}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

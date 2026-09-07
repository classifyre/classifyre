import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Archivo_Black,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  League_Gothic,
} from "next/font/google";

import "@workspace/ui/globals.css";
import { Providers } from "@/components/providers";
import { ANALYTICS_CONFIG_PATH } from "@/lib/analytics-config";
import { isLocale, LOCALES, localeHtmlLang } from "@/lib/locale-detection";
import { siteMetadata } from "@/lib/seo-metadata";

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

/**
 * Emit one tree per locale. The server build needs this so the `beforeFiles`
 * rewrite has something to hit; the desktop static export needs it so both
 * language shells ship.
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return siteMetadata(locale);
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  // Anything that is not a locale reached this tree through a bad URL, not
  // through the rewrite; 404 rather than silently rendering English under a
  // nonsense prefix.
  if (!isLocale(locale)) notFound();

  return (
    <html lang={localeHtmlLang(locale)} suppressHydrationWarning>
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
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}

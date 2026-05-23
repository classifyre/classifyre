import type { Metadata } from "next";
import {
  Archivo_Black,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  League_Gothic,
} from "next/font/google";

import "@workspace/ui/globals.css";
import { Providers } from "@/components/providers";
import { DocumentTitleUpdater } from "@/components/document-title-updater";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

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

export const metadata: Metadata = {
  title: {
    template: `%s | ${translate(enTranslations, "app.name")}`,
    default: translate(enTranslations, "app.name"),
  },
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
        <Providers>
          <DocumentTitleUpdater />
          {children}
        </Providers>
      </body>
    </html>
  );
}

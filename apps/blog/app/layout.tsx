/**
 * Pass-through root layout.
 *
 * Each locale owns its own root layout with its own `<html lang>` —
 * `app/(en)/layout.tsx` (English, unprefixed URLs) and
 * `app/(de)/layout.tsx` (German, `/de/…` URLs) — so this file only passes
 * children through. Same pattern as `next-intl`'s `[locale]` setup.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}

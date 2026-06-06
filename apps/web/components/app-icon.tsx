"use client";

import * as React from "react";
import Image from "next/image";
import { useTheme } from "next-themes";

export const ICON_NAMES = [
  "probe",
  "finger-print",
  "feet",
  "people",
  "docs",
  "single-probe",
  "dna",
  "brush",
  "binders",
  "check-list",
  "bell",
  "language",
  "dark-mode",
  "light-mode",
  "settings",
  "sidebar",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export interface AppIconProps {
  name: IconName;
  active?: boolean;
  size?: number;
  className?: string;
}

export function AppIcon({ name, active = false, size = 16, className }: AppIconProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const mode = resolvedTheme === "dark" ? "white" : "dark";
  const state = active ? "active" : "not_active";
  const variant = `${mode}_${state}`;

  if (!mounted) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }

  return (
    <Image
      src={`/icons/${variant}/${name}.png`}
      width={size}
      height={size}
      alt={name}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}

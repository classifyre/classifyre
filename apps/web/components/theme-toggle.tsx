"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Button } from "@workspace/ui/components/button";
import { AppIcon } from "@/components/app-icon";
import { useTranslation } from "@/hooks/use-translation";

export function ThemeToggle() {
  const { setTheme, theme, resolvedTheme } = useTheme();
  const { t } = useTranslation();
  const [mounted, setMounted] = React.useState(false);

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    // If theme is system, determine current resolved theme and toggle to opposite
    if (theme === "system" || !theme) {
      // Default to system, but toggle based on resolved theme
      const current = resolvedTheme || "light";
      setTheme(current === "light" ? "dark" : "light");
    } else {
      // Toggle between light and dark
      setTheme(theme === "light" ? "dark" : "light");
    }
  };

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        className="relative rounded-[4px] border-2 border-transparent hover:border-border"
      >
        <AppIcon name="light-mode" size={20} />
        <span className="sr-only">{t("common.toggleTheme")}</span>
      </Button>
    );
  }

  // Show icon based on resolved theme (what user actually sees)
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="relative rounded-[4px] border-2 border-transparent hover:border-border"
    >
      {isDark ? <AppIcon name="light-mode" size={20} /> : <AppIcon name="dark-mode" size={20} />}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@workspace/ui/components/button";
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
        <Sun className="h-5 w-5" />
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
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

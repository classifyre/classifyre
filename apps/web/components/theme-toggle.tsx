"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Button } from "@workspace/ui/components/button";
import { Sun, Moon } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

export function ThemeToggle() {
  const { setTheme, theme, resolvedTheme } = useTheme();
  const { t } = useTranslation();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    if (theme === "system" || !theme) {
      const current = resolvedTheme || "light";
      setTheme(current === "light" ? "dark" : "light");
    } else {
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

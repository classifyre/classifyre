import * as React from "react";
import { Card, CardContent } from "./card";
import { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

export interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label: string;
  };
  className?: string;
}

export function StatsCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  className,
}: StatsCardProps) {
  return (
    <Card
      className={cn(
        "border-t-2 border-t-foreground border-b border-b-border",
        className,
      )}
    >
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              {title}
            </p>
            <div className="font-serif text-4xl font-bold">{value}</div>
          </div>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground mt-1" />}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-2">{description}</p>
        )}
        {trend && (
          <p
            className={cn(
              "text-xs mt-2",
              trend.value > 0
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-red-700 dark:text-red-400",
            )}
          >
            {trend.value > 0 ? "+" : ""}
            {trend.value}% {trend.label}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

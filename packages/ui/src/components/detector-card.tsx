import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { Badge } from "./badge";
import { Button } from "./button";
import { Switch } from "./switch";
import { cn } from "../lib/utils";
import { Shield, Settings } from "lucide-react";

export interface DetectorCardProps {
  id: string;
  name: string;
  description: string;
  category: "security" | "privacy" | "compliance" | "content" | "threat";
  severity: "critical" | "high" | "medium" | "low" | "info";
  patternCount: number;
  accuracy: number;
  enabled: boolean;
  onToggle?: (enabled: boolean) => void;
  onConfigure?: () => void;
  className?: string;
}

const categoryColors = {
  security: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  privacy: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  compliance:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  content: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  threat:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

export function DetectorCard({
  name,
  description,
  category,
  severity,
  patternCount,
  accuracy,
  enabled,
  onToggle,
  onConfigure,
  className,
}: DetectorCardProps) {
  return (
    <Card className={cn("hover:shadow-md transition-shadow", className)}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">{name}</CardTitle>
              <CardDescription className="text-xs mt-1">
                {description}
              </CardDescription>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={onToggle} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={categoryColors[category]}>{category}</Badge>
          <Badge variant="outline">Severity: {severity}</Badge>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{patternCount} patterns</span>
          <span>•</span>
          <span>{accuracy}% accuracy</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={onConfigure}
        >
          <Settings className="h-3 w-3 mr-1" />
          Configure
        </Button>
      </CardContent>
    </Card>
  );
}

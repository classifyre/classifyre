import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { SeverityBadge } from "./severity-badge";
import { StatusBadge } from "./status-badge";
import { SourceIcon, type SourceType } from "./source-icon";
import { Button } from "./button";
import { Badge } from "./badge";
import { cn } from "../lib/utils";
import { Clock, MapPin, FileCode } from "lucide-react";

export interface FindingCardProps {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  status: "new" | "open" | "resolved" | "false_positive" | "ignored";
  detectorName: string;
  message: string;
  filePath: string;
  lineNumber: number;
  matchedContent: string;
  sourceType: SourceType;
  sourceName: string;
  detectedAt: Date;
  isNew?: boolean;
  onView?: () => void;
  onResolve?: () => void;
  onFalsePositive?: () => void;
  className?: string;
}

export function FindingCard({
  severity,
  status,
  detectorName,
  message,
  filePath,
  lineNumber,
  matchedContent,
  sourceType,
  sourceName,
  detectedAt,
  isNew = false,
  onView,
  onResolve,
  onFalsePositive,
  className,
}: FindingCardProps) {
  return (
    <Card className={cn("hover:shadow-md transition-shadow", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={severity}>
              {severity.toUpperCase()}
            </SeverityBadge>
            <StatusBadge status={status}>
              {status.replace("_", " ")}
            </StatusBadge>
            {isNew && <Badge variant="secondary">NEW</Badge>}
          </div>
        </div>
        <CardTitle className="text-base mt-2">{message}</CardTitle>
        <CardDescription className="flex items-center gap-1 text-xs">
          <FileCode className="h-3 w-3" />
          {detectorName}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Location */}
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-xs truncate">{filePath}</p>
            <p className="text-xs text-muted-foreground">Line {lineNumber}</p>
          </div>
        </div>

        {/* Source */}
        <div className="flex items-center gap-2 text-sm">
          <SourceIcon source={sourceType} size="sm" />
          <span className="text-xs text-muted-foreground">{sourceName}</span>
          <span className="text-xs text-muted-foreground">•</span>
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {detectedAt.toLocaleDateString()}
          </span>
        </div>

        {/* Matched Content */}
        <div className="rounded-md bg-muted p-2 font-mono text-xs overflow-x-auto">
          <code>{matchedContent}</code>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button size="sm" variant="default" onClick={onView}>
            View Details
          </Button>
          {status === "open" && (
            <>
              <Button size="sm" variant="outline" onClick={onResolve}>
                Mark Resolved
              </Button>
              <Button size="sm" variant="ghost" onClick={onFalsePositive}>
                False Positive
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

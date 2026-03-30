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
import { SourceIcon, type SourceType } from "./source-icon";
import { cn } from "../lib/utils";
import { Clock, ExternalLink, FileText, Hash } from "lucide-react";

export interface AssetCardProps {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  externalUrn?: string;
  preview?: string;
  sourceId?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  checksum?: string;
  className?: string;
  onView?: () => void;
}

export function AssetCard({
  name,
  type,
  subtype,
  externalUrn,
  preview,
  createdAt,
  checksum,
  className,
  onView,
}: AssetCardProps) {
  const sourceType = type.toLowerCase() as SourceType;

  return (
    <Card className={cn("hover:shadow-md transition-shadow", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <SourceIcon source={sourceType} size="md" />
            <div className="space-y-1">
              <CardTitle className="text-base line-clamp-1" title={name}>
                {name}
              </CardTitle>
              <CardDescription className="flex items-center gap-2 text-xs">
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 uppercase"
                >
                  {subtype || "Asset"}
                </Badge>
                {createdAt && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(createdAt).toLocaleDateString()}
                  </span>
                )}
              </CardDescription>
            </div>
          </div>
          {externalUrn && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => window.open(externalUrn, "_blank")}
              title="Open External Link"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {preview && (
          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground line-clamp-3 font-mono">
            {preview}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {checksum && (
              <div
                className="flex items-center gap-1"
                title={`Checksum: ${checksum}`}
              >
                <Hash className="h-3 w-3" />
                <span className="font-mono">{checksum.substring(0, 8)}...</span>
              </div>
            )}
          </div>

          {onView && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onView}
              className="h-7 text-xs"
            >
              <FileText className="mr-1 h-3 w-3" />
              Details
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

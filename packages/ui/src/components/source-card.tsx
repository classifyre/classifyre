import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { SourceIcon, type SourceType } from "./source-icon";
import { Button } from "./button";
import { Badge } from "./badge";
import { cn } from "../lib/utils";
import { Clock, AlertCircle, CheckCircle2, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export interface SourceCardProps {
  id: string;
  name?: string;
  type?: string;
  runnerStatus?: string;
  createdAt?: string;
  fileCount?: number;
  findingCount?: number;
  onScan?: () => void;
  onView?: () => void;
  onConfigure?: () => void;
  onDelete?: () => void;
  className?: string;
}

export function SourceCard({
  name,
  type,
  runnerStatus,
  createdAt,
  fileCount,
  findingCount,
  onScan,
  onView,
  onConfigure,
  onDelete,
  className,
}: SourceCardProps) {
  // Map runnerStatus to status
  const getStatus = (
    runnerStatus?: string,
  ): "healthy" | "error" | "pending" => {
    if (!runnerStatus) return "pending";
    if (runnerStatus === "COMPLETED") return "healthy";
    if (runnerStatus === "ERROR") return "error";
    return "pending";
  };

  const status = getStatus(runnerStatus);

  const statusConfig = {
    healthy: {
      icon: CheckCircle2,
      color: "text-green-600",
      label: "Healthy",
    },
    error: {
      icon: AlertCircle,
      color: "text-red-600",
      label: "Error",
    },
    pending: {
      icon: Clock,
      color: "text-yellow-600",
      label: "Pending",
    },
  };

  const StatusIcon = statusConfig[status].icon;
  const sourceType = type?.toLowerCase() as SourceType | undefined;

  return (
    <Card className={cn("hover:shadow-md transition-shadow", className)}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <SourceIcon source={sourceType || "filesystem"} size="lg" />
            <div>
              <CardTitle className="text-base">
                {name || "Unnamed Source"}
              </CardTitle>
              <CardDescription className="text-xs font-mono mt-1">
                {type || "Unknown"}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={status === "healthy" ? "default" : "destructive"}
              className="gap-1"
            >
              <StatusIcon className="h-3 w-3" />
              {statusConfig[status].label}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Source actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onScan && (
                  <DropdownMenuItem onClick={onScan}>Scan Now</DropdownMenuItem>
                )}
                {onConfigure && (
                  <DropdownMenuItem onClick={onConfigure}>
                    Configure
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="text-destructive"
                  >
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {createdAt && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(createdAt).toLocaleDateString()}
            </span>
          )}
          {fileCount !== undefined && (
            <span>{fileCount.toLocaleString()} files</span>
          )}
          {findingCount !== undefined && (
            <span className="font-semibold text-foreground">
              {findingCount} findings
            </span>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          {onView && (
            <Button size="sm" variant="outline" onClick={onView}>
              View source
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

import { Badge } from "@workspace/ui/components";
import { formatAssetKind, getAssetKindIcon } from "@/lib/asset-kind";

type Props = {
  kind?: string | null;
  className?: string;
};

/** Shared icon + label badge for an asset's catalog kind (file, page, ...). */
export function AssetKindBadge({ kind, className }: Props) {
  if (!kind) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const Icon = getAssetKindIcon(kind);
  return (
    <Badge variant="outline" className={className ? `gap-1.5 ${className}` : "gap-1.5"}>
      <Icon className="h-3 w-3 text-muted-foreground" />
      {formatAssetKind(kind)}
    </Badge>
  );
}

import {
  Database,
  File,
  FileText,
  Hash,
  Image,
  Link2,
  Mail,
  MessageSquare,
  Notebook,
  Paperclip,
  Table,
  Workflow,
  type LucideIcon,
} from "lucide-react";

// Catalog asset kind (file, image, page, comment, table, ...) → icon.
// Mirrors the asset kinds declared in x-asset-metadata.
const assetKindIconMap: Record<string, LucideIcon> = {
  file: File,
  image: Image,
  page: FileText,
  post: FileText,
  comment: MessageSquare,
  comments: MessageSquare,
  message: MessageSquare,
  email: Mail,
  issue: FileText,
  attachment: Paperclip,
  linked_file: Link2,
  table: Table,
  data_source: Database,
  collection: Database,
  notebook: Notebook,
  pipeline: Workflow,
  label: Hash,
  item: File,
};

export function getAssetKindIcon(kind?: string | null): LucideIcon {
  if (!kind) return File;
  return assetKindIconMap[kind.toLowerCase()] ?? File;
}

/** "data_source" → "Data Source", "file" → "File". */
export function formatAssetKind(kind?: string | null): string {
  if (!kind) return "—";
  return kind
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

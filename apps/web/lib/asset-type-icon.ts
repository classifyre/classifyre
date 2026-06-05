import {
  Binary,
  File,
  FileText,
  Globe,
  Image,
  Music,
  Table,
  Video,
  type LucideIcon,
} from "lucide-react";

// Content category (AssetContentType: TXT/IMAGE/VIDEO/...) → icon. Used by the
// sandbox runs table, where contentType is still the content-category enum.
const contentTypeIconMap: Record<string, LucideIcon> = {
  TXT: FileText,
  IMAGE: Image,
  VIDEO: Video,
  AUDIO: Music,
  URL: Globe,
  TABLE: Table,
  BINARY: Binary,
  OTHER: File,
};

export function getAssetTypeIcon(contentType?: string | null): LucideIcon {
  if (!contentType) return File;
  return contentTypeIconMap[contentType.toUpperCase()] ?? File;
}

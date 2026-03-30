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
import { AssetListItemDtoAssetTypeEnum } from "@workspace/api-client";

export const assetTypeIconMap: Record<
  AssetListItemDtoAssetTypeEnum,
  LucideIcon
> = {
  [AssetListItemDtoAssetTypeEnum.Txt]: FileText,
  [AssetListItemDtoAssetTypeEnum.Image]: Image,
  [AssetListItemDtoAssetTypeEnum.Video]: Video,
  [AssetListItemDtoAssetTypeEnum.Audio]: Music,
  [AssetListItemDtoAssetTypeEnum.Url]: Globe,
  [AssetListItemDtoAssetTypeEnum.Table]: Table,
  [AssetListItemDtoAssetTypeEnum.Binary]: Binary,
  [AssetListItemDtoAssetTypeEnum.Other]: File,
};

export function getAssetTypeIcon(assetType?: string | null): LucideIcon {
  if (!assetType) return File;
  return assetTypeIconMap[assetType as AssetListItemDtoAssetTypeEnum] ?? File;
}

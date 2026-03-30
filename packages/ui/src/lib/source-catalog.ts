import { CreateSourceDtoTypeEnum } from "@workspace/api-client/types";
import type { SourceType as IconSourceType } from "../components/source-icon";

export type SourceCatalogCategory =
  | "DATABASES"
  | "WAREHOUSE_LAKEHOUSE"
  | "WEB_AND_UGC"
  | "COLLABORATION"
  | "ANALYTICS_BI"
  | "OTHER";

export type SourceCatalogMeta = {
  label: string;
  description: string;
  icon: IconSourceType | string;
  category: SourceCatalogCategory;
  keywords: string[];
};

export type SourceCatalogEntry = SourceCatalogMeta & {
  type: string;
  href?: string;
};

export const SOURCE_CATEGORY_META: Record<
  SourceCatalogCategory,
  { label: string; description: string }
> = {
  DATABASES: {
    label: "Databases",
    description:
      "Operational and document stores for row and collection scans.",
  },
  WAREHOUSE_LAKEHOUSE: {
    label: "Warehouse & Lakehouse",
    description: "Analytical compute platforms and catalog-first ingestion.",
  },
  WEB_AND_UGC: {
    label: "Web & UGC",
    description: "Public-facing websites and user-generated content.",
  },
  COLLABORATION: {
    label: "Collaboration",
    description: "Team communication and workspace activity streams.",
  },
  ANALYTICS_BI: {
    label: "Analytics & BI",
    description: "Dashboards, reports, and business intelligence assets.",
  },
  OTHER: {
    label: "Other",
    description:
      "Sources discovered in schema that have not been categorized yet.",
  },
};

export const SOURCE_CATEGORY_ORDER: SourceCatalogCategory[] = [
  "DATABASES",
  "WAREHOUSE_LAKEHOUSE",
  "WEB_AND_UGC",
  "COLLABORATION",
  "ANALYTICS_BI",
  "OTHER",
];

export const SOURCE_TYPE_CATALOG_META: Record<string, SourceCatalogMeta> = {
  WORDPRESS: {
    label: "WordPress",
    description: "Connect to WordPress to scan posts and pages.",
    icon: CreateSourceDtoTypeEnum.Wordpress,
    category: "WEB_AND_UGC",
    keywords: ["cms", "blog", "ugc", "content"],
  },
  SLACK: {
    label: "Slack",
    description: "Connect to Slack to scan channel messages.",
    icon: CreateSourceDtoTypeEnum.Slack,
    category: "COLLABORATION",
    keywords: ["chat", "messages", "workspace"],
  },
  SITEMAP: {
    label: "Website Index",
    description:
      "Scan website content from your sitemap for continuous monitoring.",
    icon: CreateSourceDtoTypeEnum.Sitemap,
    category: "WEB_AND_UGC",
    keywords: ["site", "crawl", "web", "urls"],
  },
  S3_COMPATIBLE_STORAGE: {
    label: "S3-Compatible Storage",
    description:
      "Scan objects from AWS S3, MinIO, Cloudflare R2, Backblaze B2, and other S3-compatible endpoints.",
    icon: CreateSourceDtoTypeEnum.S3CompatibleStorage,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["s3", "minio", "r2", "backblaze", "object storage", "files"],
  },
  AZURE_BLOB_STORAGE: {
    label: "Azure Blob Storage",
    description:
      "Scan blobs from Azure Storage containers with key, SAS, or managed identity auth.",
    icon: CreateSourceDtoTypeEnum.AzureBlobStorage,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["azure", "blob", "container", "object storage", "files"],
  },
  GOOGLE_CLOUD_STORAGE: {
    label: "Google Cloud Storage",
    description:
      "Scan objects from Google Cloud Storage buckets with ADC or service account credentials.",
    icon: CreateSourceDtoTypeEnum.GoogleCloudStorage,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["gcs", "google cloud", "bucket", "object storage", "files"],
  },
  POSTGRESQL: {
    label: "PostgreSQL",
    description: "Scan PostgreSQL tables with detector-ready row sampling.",
    icon: CreateSourceDtoTypeEnum.Postgresql,
    category: "DATABASES",
    keywords: ["sql", "relational", "rdbms"],
  },
  MYSQL: {
    label: "MySQL",
    description: "Scan MySQL tables with detector-ready row sampling.",
    icon: CreateSourceDtoTypeEnum.Mysql,
    category: "DATABASES",
    keywords: ["sql", "relational", "rdbms"],
  },
  MSSQL: {
    label: "MSSQL",
    description: "Scan Microsoft SQL Server tables and views.",
    icon: CreateSourceDtoTypeEnum.Mssql,
    category: "DATABASES",
    keywords: ["sql", "microsoft", "relational", "rdbms"],
  },
  ORACLE: {
    label: "Oracle",
    description: "Scan Oracle service objects with optional view lineage.",
    icon: CreateSourceDtoTypeEnum.Oracle,
    category: "DATABASES",
    keywords: ["sql", "relational", "enterprise", "rdbms"],
  },
  HIVE: {
    label: "Hive",
    description: "Scan Hive tables and views across selected databases.",
    icon: CreateSourceDtoTypeEnum.Hive,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["metastore", "hadoop", "analytics"],
  },
  DATABRICKS: {
    label: "Databricks",
    description: "Scan Unity Catalog assets, notebooks, and pipelines.",
    icon: CreateSourceDtoTypeEnum.Databricks,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["lakehouse", "unity catalog", "spark"],
  },
  SNOWFLAKE: {
    label: "Snowflake",
    description:
      "Scan Snowflake tables and views with flexible authentication.",
    icon: CreateSourceDtoTypeEnum.Snowflake,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["warehouse", "analytics", "cloud"],
  },
  MONGODB: {
    label: "MongoDB",
    description: "Scan MongoDB collections for Atlas or on-prem deployments.",
    icon: CreateSourceDtoTypeEnum.Mongodb,
    category: "DATABASES",
    keywords: ["document", "nosql", "collections"],
  },
  POWERBI: {
    label: "Power BI",
    description: "Scan Power BI workspaces, datasets, reports, and dashboards.",
    icon: CreateSourceDtoTypeEnum.Powerbi,
    category: "ANALYTICS_BI",
    keywords: ["dashboards", "reports", "visualization"],
  },
  TABLEAU: {
    label: "Tableau",
    description: "Scan Tableau workbooks and datasources.",
    icon: CreateSourceDtoTypeEnum.Tableau,
    category: "ANALYTICS_BI",
    keywords: ["dashboards", "reports", "visualization"],
  },
  CONFLUENCE: {
    label: "Confluence",
    description: "Scan Confluence spaces, pages, comments, and attachments.",
    icon: CreateSourceDtoTypeEnum.Confluence,
    category: "COLLABORATION",
    keywords: ["wiki", "knowledge base", "pages", "spaces"],
  },
  JIRA: {
    label: "Jira",
    description: "Scan Jira issues, comments, links, and attachments.",
    icon: CreateSourceDtoTypeEnum.Jira,
    category: "COLLABORATION",
    keywords: ["tickets", "issues", "projects", "jql"],
  },
  SERVICEDESK: {
    label: "Service Desk",
    description:
      "Scan Jira Service Management requests, comments, and attachments.",
    icon: CreateSourceDtoTypeEnum.Servicedesk,
    category: "COLLABORATION",
    keywords: ["support", "requests", "tickets", "queues"],
  },
};

function fallbackLabelFromType(sourceType: string): string {
  return sourceType
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function resolveSourceCatalogMeta(
  sourceType: string,
  fallback?: Partial<
    Pick<
      SourceCatalogMeta,
      "label" | "description" | "category" | "icon" | "keywords"
    >
  >,
): SourceCatalogMeta {
  const normalizedType = sourceType.toUpperCase();
  const known = SOURCE_TYPE_CATALOG_META[normalizedType];

  if (known) {
    return {
      ...known,
      label: fallback?.label ?? known.label,
      description: fallback?.description ?? known.description,
      category: fallback?.category ?? known.category,
      icon: fallback?.icon ?? known.icon,
      keywords: fallback?.keywords ?? known.keywords,
    };
  }

  return {
    label: fallback?.label ?? fallbackLabelFromType(normalizedType),
    description:
      fallback?.description ?? "Connector discovered from schema metadata.",
    category: fallback?.category ?? "OTHER",
    icon: fallback?.icon ?? normalizedType,
    keywords: fallback?.keywords ?? [normalizedType.toLowerCase()],
  };
}

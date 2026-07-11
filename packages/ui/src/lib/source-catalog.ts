import { CreateSourceDtoTypeEnum } from "@workspace/api-client/types";
import { getSourceLabel } from "@workspace/schemas/source-labels";
import type { SourceType as IconSourceType } from "../components/source-icon";

export type SourceCatalogCategory =
  | "DATABASES"
  | "GRAPH_DATABASES"
  | "WAREHOUSE_LAKEHOUSE"
  | "STREAMING"
  | "WEB_AND_UGC"
  | "SOCIAL_MEDIA"
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

// The canonical `label` lives in the schema (`all_input_sources.json`) and is
// resolved via `getSourceLabel`, so catalog entries only carry web-specific
// metadata (description/icon/category/keywords).
type SourceCatalogMetaBase = Omit<SourceCatalogMeta, "label">;

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
  GRAPH_DATABASES: {
    label: "Graph Databases",
    description: "Graph-native stores with node and relationship traversal.",
  },
  WAREHOUSE_LAKEHOUSE: {
    label: "Warehouse & Lakehouse",
    description: "Analytical compute platforms and catalog-first ingestion.",
  },
  STREAMING: {
    label: "Streaming",
    description: "Event streams and message brokers sampled for content.",
  },
  WEB_AND_UGC: {
    label: "Web & UGC",
    description: "Public-facing websites and user-generated content.",
  },
  SOCIAL_MEDIA: {
    label: "Social Media",
    description: "Social and video platforms with public posts and transcripts.",
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
  "GRAPH_DATABASES",
  "WAREHOUSE_LAKEHOUSE",
  "STREAMING",
  "WEB_AND_UGC",
  "SOCIAL_MEDIA",
  "COLLABORATION",
  "ANALYTICS_BI",
  "OTHER",
];

export const SOURCE_TYPE_CATALOG_META: Record<string, SourceCatalogMetaBase> = {
  WORDPRESS: {
    description: "Connect to WordPress to scan posts and pages.",
    icon: CreateSourceDtoTypeEnum.Wordpress,
    category: "WEB_AND_UGC",
    keywords: ["cms", "blog", "ugc", "content"],
  },
  SLACK: {
    description: "Connect to Slack to scan channel messages.",
    icon: CreateSourceDtoTypeEnum.Slack,
    category: "COLLABORATION",
    keywords: ["chat", "messages", "workspace"],
  },
  S3_COMPATIBLE_STORAGE: {
    description:
      "Scan objects from AWS S3, MinIO, Cloudflare R2, Backblaze B2, and other S3-compatible endpoints.",
    icon: CreateSourceDtoTypeEnum.S3CompatibleStorage,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["s3", "minio", "r2", "backblaze", "object storage", "files"],
  },
  AZURE_BLOB_STORAGE: {
    description:
      "Scan blobs from Azure Storage containers with key, SAS, or managed identity auth.",
    icon: CreateSourceDtoTypeEnum.AzureBlobStorage,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["azure", "blob", "container", "object storage", "files"],
  },
  GOOGLE_CLOUD_STORAGE: {
    description:
      "Scan objects from Google Cloud Storage buckets with ADC or service account credentials.",
    icon: CreateSourceDtoTypeEnum.GoogleCloudStorage,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["gcs", "google cloud", "bucket", "object storage", "files"],
  },
  POSTGRESQL: {
    description: "Scan PostgreSQL tables with detector-ready row sampling.",
    icon: CreateSourceDtoTypeEnum.Postgresql,
    category: "DATABASES",
    keywords: ["sql", "relational", "rdbms"],
  },
  MYSQL: {
    description: "Scan MySQL tables with detector-ready row sampling.",
    icon: CreateSourceDtoTypeEnum.Mysql,
    category: "DATABASES",
    keywords: ["sql", "relational", "rdbms"],
  },
  MSSQL: {
    description: "Scan Microsoft SQL Server tables and views.",
    icon: CreateSourceDtoTypeEnum.Mssql,
    category: "DATABASES",
    keywords: ["sql", "microsoft", "relational", "rdbms"],
  },
  ORACLE: {
    description: "Scan Oracle service objects with optional view lineage.",
    icon: CreateSourceDtoTypeEnum.Oracle,
    category: "DATABASES",
    keywords: ["sql", "relational", "enterprise", "rdbms"],
  },
  HIVE: {
    description: "Scan Hive tables and views across selected databases.",
    icon: CreateSourceDtoTypeEnum.Hive,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["metastore", "hadoop", "analytics"],
  },
  DATABRICKS: {
    description: "Scan Unity Catalog assets, notebooks, and pipelines.",
    icon: CreateSourceDtoTypeEnum.Databricks,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["lakehouse", "unity catalog", "spark"],
  },
  SNOWFLAKE: {
    description:
      "Scan Snowflake tables and views with flexible authentication.",
    icon: CreateSourceDtoTypeEnum.Snowflake,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["warehouse", "analytics", "cloud"],
  },
  MONGODB: {
    description: "Scan MongoDB collections for Atlas or on-prem deployments.",
    icon: CreateSourceDtoTypeEnum.Mongodb,
    category: "DATABASES",
    keywords: ["document", "nosql", "collections"],
  },
  NEO4J: {
    description:
      "Scan Neo4j node labels and relationship structure for graph data.",
    icon: CreateSourceDtoTypeEnum.Neo4J,
    category: "GRAPH_DATABASES",
    keywords: ["graph", "cypher", "nodes", "relationships", "bolt"],
  },
  POWERBI: {
    description: "Scan Power BI workspaces, datasets, reports, and dashboards.",
    icon: CreateSourceDtoTypeEnum.Powerbi,
    category: "ANALYTICS_BI",
    keywords: ["dashboards", "reports", "visualization"],
  },
  TABLEAU: {
    description: "Scan Tableau workbooks and datasources.",
    icon: CreateSourceDtoTypeEnum.Tableau,
    category: "ANALYTICS_BI",
    keywords: ["dashboards", "reports", "visualization"],
  },
  CONFLUENCE: {
    description: "Scan Confluence spaces, pages, comments, and attachments.",
    icon: CreateSourceDtoTypeEnum.Confluence,
    category: "COLLABORATION",
    keywords: ["wiki", "knowledge base", "pages", "spaces"],
  },
  JIRA: {
    description: "Scan Jira issues, comments, links, and attachments.",
    icon: CreateSourceDtoTypeEnum.Jira,
    category: "COLLABORATION",
    keywords: ["tickets", "issues", "projects", "jql"],
  },
  SERVICEDESK: {
    description:
      "Scan Jira Service Management requests, comments, and attachments.",
    icon: CreateSourceDtoTypeEnum.Servicedesk,
    category: "COLLABORATION",
    keywords: ["support", "requests", "tickets", "queues"],
  },
  SQLITE: {
    description:
      "Scan tables in a local SQLite database file with no server required.",
    icon: CreateSourceDtoTypeEnum.Sqlite,
    category: "DATABASES",
    keywords: ["sql", "file", "embedded", "local", "rdbms"],
  },
  NOTION: {
    description:
      "Scan Notion pages, data sources, comments, and file attachments.",
    icon: CreateSourceDtoTypeEnum.Notion,
    category: "COLLABORATION",
    keywords: ["wiki", "pages", "databases", "blocks", "notes"],
  },
  EMAIL: {
    description:
      "Scan IMAP mailboxes (Gmail, Outlook/M365, and more) for messages and attachments.",
    icon: CreateSourceDtoTypeEnum.Email,
    category: "COLLABORATION",
    keywords: ["imap", "gmail", "outlook", "mailbox", "messages", "attachments"],
  },
  YOUTUBE: {
    description:
      "Scan YouTube channels and videos, fetching metadata and transcripts for detection.",
    icon: CreateSourceDtoTypeEnum.Youtube,
    category: "SOCIAL_MEDIA",
    keywords: ["video", "social media", "ugc", "captions", "transcript", "channel"],
  },
  DELTA_LAKE: {
    description:
      "Scan Delta Lake tables in S3-compatible storage — schema, versions, and row sampling, no Spark required.",
    icon: CreateSourceDtoTypeEnum.DeltaLake,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["lakehouse", "delta", "parquet", "tables", "s3"],
  },
  ICEBERG: {
    description:
      "Scan Apache Iceberg tables in S3-compatible storage — schema, snapshots, and row sampling, no Spark required.",
    icon: CreateSourceDtoTypeEnum.Iceberg,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["lakehouse", "iceberg", "snapshots", "tables", "s3"],
  },
  KAFKA: {
    description:
      "Discover Kafka topics and sample messages for detection.",
    icon: CreateSourceDtoTypeEnum.Kafka,
    category: "STREAMING",
    keywords: ["kafka", "streaming", "events", "topics", "messages", "broker"],
  },
  ELASTICSEARCH: {
    description:
      "Discover Elasticsearch indices and sample documents for detection.",
    icon: CreateSourceDtoTypeEnum.Elasticsearch,
    category: "DATABASES",
    keywords: ["search", "index", "full-text", "lucene", "elastic"],
  },
  OPENSEARCH: {
    description:
      "Discover OpenSearch indices and sample documents for detection.",
    icon: CreateSourceDtoTypeEnum.Opensearch,
    category: "DATABASES",
    keywords: ["search", "index", "full-text", "lucene", "opensearch"],
  },
  MEILISEARCH: {
    description:
      "Discover Meilisearch indexes and sample documents for detection.",
    icon: CreateSourceDtoTypeEnum.Meilisearch,
    category: "DATABASES",
    keywords: ["search", "index", "full-text", "meilisearch"],
  },
  LOCAL_FOLDER: {
    description:
      "Scan a folder on this computer for documents, spreadsheets, and images.",
    icon: CreateSourceDtoTypeEnum.LocalFolder,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["folder", "files", "local", "filesystem", "desktop", "documents"],
  },
};

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
  const label = fallback?.label ?? getSourceLabel(normalizedType);

  if (known) {
    return {
      ...known,
      label,
      description: fallback?.description ?? known.description,
      category: fallback?.category ?? known.category,
      icon: fallback?.icon ?? known.icon,
      keywords: fallback?.keywords ?? known.keywords,
    };
  }

  return {
    label,
    description:
      fallback?.description ?? "Connector discovered from schema metadata.",
    category: fallback?.category ?? "OTHER",
    icon: fallback?.icon ?? normalizedType,
    keywords: fallback?.keywords ?? [normalizedType.toLowerCase()],
  };
}

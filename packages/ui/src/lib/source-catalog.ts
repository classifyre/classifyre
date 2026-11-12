import { CreateSourceDtoTypeEnum } from "@workspace/api-client/types";
import { getSourceLabel } from "@workspace/schemas/source-labels";
import type { SourceType as IconSourceType } from "../components/source-icon";

export type SourceCatalogCategory =
  | "DATABASES"
  | "GRAPH_DATABASES"
  | "WAREHOUSE_LAKEHOUSE"
  | "CODE_REPOSITORIES"
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
  CODE_REPOSITORIES: {
    label: "Code Repositories",
    description: "Version-controlled source, configuration, and documentation.",
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
    description:
      "Social and video platforms with public posts and transcripts.",
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
      "Connectors you write yourself, direct file uploads and mounted folders.",
  },
};

export const SOURCE_CATEGORY_ORDER: SourceCatalogCategory[] = [
  "DATABASES",
  "GRAPH_DATABASES",
  "WAREHOUSE_LAKEHOUSE",
  "CODE_REPOSITORIES",
  "STREAMING",
  "WEB_AND_UGC",
  "SOCIAL_MEDIA",
  "COLLABORATION",
  "ANALYTICS_BI",
  "OTHER",
];

export const SOURCE_TYPE_CATALOG_META: Record<string, SourceCatalogMetaBase> = {
  CUSTOM: {
    description:
      "Write the connector yourself in a Python notebook, for a system nothing else covers.",
    icon: CreateSourceDtoTypeEnum.Custom,
    category: "OTHER",
    keywords: ["custom", "python", "notebook", "code", "script", "api", "bespoke"],
  },
  SANDBOX: {
    description:
      "Upload files directly and scan them through the standard source lifecycle.",
    icon: CreateSourceDtoTypeEnum.Sandbox,
    category: "OTHER",
    keywords: ["upload", "files", "documents", "ad hoc", "sandbox"],
  },
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
  DREMIO: {
    description:
      "Scan Dremio tables and views with lineage across spaces and sources.",
    icon: CreateSourceDtoTypeEnum.Dremio,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["lakehouse", "semantic layer", "federation", "iceberg"],
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
    keywords: [
      "imap",
      "gmail",
      "outlook",
      "mailbox",
      "messages",
      "attachments",
    ],
  },
  YOUTUBE: {
    description:
      "Scan YouTube channels and videos, fetching metadata and transcripts for detection.",
    icon: CreateSourceDtoTypeEnum.Youtube,
    category: "SOCIAL_MEDIA",
    keywords: [
      "video",
      "social media",
      "ugc",
      "captions",
      "transcript",
      "channel",
    ],
  },
  REDDIT: {
    description:
      "Scan subreddits — posts, threaded comments, attached media, and linked video transcripts. Always read-only.",
    icon: CreateSourceDtoTypeEnum.Reddit,
    category: "SOCIAL_MEDIA",
    keywords: [
      "social media",
      "ugc",
      "forum",
      "subreddit",
      "posts",
      "comments",
      "threads",
    ],
  },
  ICEBERG_REST: {
    description:
      "Scan every table of an Iceberg REST catalog — Polaris, Snowflake Open Catalog, Unity Catalog, Nessie, Gravitino, Lakekeeper, S3 Tables, Glue, BigLake.",
    icon: CreateSourceDtoTypeEnum.IcebergRest,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["lakehouse", "iceberg", "catalog", "polaris", "unity", "nessie", "glue", "s3 tables", "biglake"],
  },
  DUCKLAKE: {
    description:
      "Scan a DuckLake — its catalog in Postgres, MySQL, SQLite or DuckDB, its data in object storage.",
    icon: CreateSourceDtoTypeEnum.Ducklake,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["lakehouse", "ducklake", "duckdb", "parquet", "tables"],
  },
  TRINO: {
    description:
      "Scan every catalog of a Trino or Starburst cluster — Iceberg, Delta Lake, Hudi, Hive and more.",
    icon: CreateSourceDtoTypeEnum.Trino,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["trino", "starburst", "galaxy", "presto", "lakehouse", "federation"],
  },
  ODBC: {
    description:
      "Scan any database that has an ODBC driver — SQL Server, Oracle, DB2, Teradata, Informix or a data source set up on the scanning host.",
    icon: CreateSourceDtoTypeEnum.Odbc,
    category: "DATABASES",
    keywords: ["odbc", "driver", "dsn", "jdbc", "legacy", "sql server", "oracle", "db2", "teradata", "informix"],
  },
  ATHENA: {
    description: "Scan the AWS Glue Data Catalog through Amazon Athena — Iceberg, Delta, Hudi and file tables in S3.",
    icon: CreateSourceDtoTypeEnum.Athena,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["aws", "athena", "glue", "lakehouse", "s3", "iceberg"],
  },
  BIGQUERY: {
    description: "Scan BigQuery datasets, including BigLake and Iceberg tables, without paying for full-table queries.",
    icon: CreateSourceDtoTypeEnum.Bigquery,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["google", "bigquery", "biglake", "warehouse", "gcp"],
  },
  REDSHIFT: {
    description: "Scan Amazon Redshift, including Redshift Spectrum external tables in S3.",
    icon: CreateSourceDtoTypeEnum.Redshift,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: ["aws", "redshift", "spectrum", "warehouse"],
  },
  KAFKA: {
    description: "Discover Kafka topics and sample messages for detection.",
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
      "Scan a folder of documents, spreadsheets and images — on this computer, or mounted into the cluster.",
    icon: CreateSourceDtoTypeEnum.LocalFolder,
    category: "OTHER",
    keywords: [
      "folder",
      "files",
      "local",
      "filesystem",
      "docker",
      "bind mount",
      "documents",
      "mount",
      "volume",
      "pvc",
      "directory",
      "path",
    ],
  },
  MICROSOFT_365: {
    description:
      "Scan SharePoint sites, OneDrive files, and Teams files via Microsoft Graph API.",
    icon: CreateSourceDtoTypeEnum.Microsoft365,
    category: "COLLABORATION",
    keywords: [
      "microsoft",
      "sharepoint",
      "onedrive",
      "teams",
      "office 365",
      "graph",
      "m365",
    ],
  },
  GOOGLE_WORKSPACE: {
    description:
      "Scan Google Drive files, Docs, Sheets, and Slides across My Drive and shared drives.",
    icon: CreateSourceDtoTypeEnum.GoogleWorkspace,
    category: "COLLABORATION",
    keywords: [
      "google",
      "drive",
      "docs",
      "sheets",
      "slides",
      "workspace",
      "gdrive",
    ],
  },
  DROPBOX: {
    description:
      "Scan documents, spreadsheets, images, and Paper docs stored in a Dropbox account.",
    icon: CreateSourceDtoTypeEnum.Dropbox,
    category: "COLLABORATION",
    keywords: [
      "dropbox",
      "files",
      "cloud storage",
      "documents",
      "paper",
      "shared folders",
    ],
  },
  HUGGING_FACE: {
    description:
      "Stream files from a Hugging Face dataset, model, or space repository without cloning it.",
    icon: CreateSourceDtoTypeEnum.HuggingFace,
    category: "WAREHOUSE_LAKEHOUSE",
    keywords: [
      "hugging face",
      "huggingface",
      "hf",
      "dataset",
      "model",
      "parquet",
      "hub",
      "ml",
    ],
  },
  GIT: {
    description:
      "Scan the source, configuration, and documents on one branch of any Git repository — GitHub, GitLab, Bitbucket, Azure DevOps, or self-hosted.",
    icon: CreateSourceDtoTypeEnum.Git,
    category: "CODE_REPOSITORIES",
    keywords: [
      "git",
      "github",
      "gitlab",
      "bitbucket",
      "azure devops",
      "gitea",
      "repository",
      "repo",
      "source code",
      "branch",
      "clone",
      "ssh",
    ],
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

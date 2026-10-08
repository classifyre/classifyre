import * as React from "react";
import {
  siApachehive,
  siApachekafka,
  siBitbucket,
  siConfluence,
  siDatabricks,
  siDropbox,
  siElasticsearch,
  siGit,
  siGithub,
  siGoogledocs,
  siGoogledrive,
  siGooglesheets,
  siGoogleslides,
  siHuggingface,
  siJira,
  siMeilisearch,
  siMongodb,
  siMysql,
  siNeo4j,
  siNotion,
  siOpensearch,
  siPostgresql,
  siReddit,
  siSnowflake,
  siWordpress,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";
import {
  CreateSourceDtoTypeEnum,
  type CreateSourceDtoTypeEnum as ApiSourceType,
} from "@workspace/api-client/types";
import {
  BookOpen,
  Cloud,
  Code2,
  Database,
  Folder,
  FlaskConical,
  Layers,
  Mail,
  Monitor,
  Settings,
} from "lucide-react";
import { cn } from "../lib/utils";
import { simpleIconComponent } from "./simple-icon";

type IconComponent = React.ComponentType<{ className?: string }>;

const FALLBACK_SOURCE_ICON: IconComponent = Database;

const SlackIcon: IconComponent = ({ className }) => (
  <svg
    viewBox="73 73 124 124"
    className={className}
    fill="currentColor"
    role="img"
    aria-label="Slack"
  >
    <path d="M99.4 151.2a12.9 12.9 0 1 1-25.8 0 12.9 12.9 0 0 1 25.8 0Zm6.5 0a12.9 12.9 0 1 1 25.8 0v32.3a12.9 12.9 0 1 1-25.8 0v-32.3ZM118.8 99.4a12.9 12.9 0 1 1 0-25.8 12.9 12.9 0 0 1 0 25.8Zm0 6.5a12.9 12.9 0 0 1 0 25.8H86.5a12.9 12.9 0 1 1 0-25.8h32.3Zm51.8 12.9a12.9 12.9 0 1 1 25.8 0 12.9 12.9 0 0 1-25.8 0Zm-6.5 0a12.9 12.9 0 1 1-25.8 0V86.5a12.9 12.9 0 1 1 25.8 0v32.3ZM151.2 170.6a12.9 12.9 0 1 1 0 25.8 12.9 12.9 0 0 1 0-25.8Zm0-6.5a12.9 12.9 0 1 1 0-25.8h32.3a12.9 12.9 0 1 1 0 25.8h-32.3Z" />
  </svg>
);

const OracleIcon: IconComponent = ({ className }) => (
  <svg
    viewBox="0 0 93.9 59.4"
    className={className}
    fill="currentColor"
    role="img"
    aria-label="Oracle"
  >
    <path d="M30.5 59.4H65c16.4-.4 29.3-14.1 28.9-30.4C93.5 13.1 80.7.4 65 0H30.5C14.1-.4.4 12.5 0 28.9s12.5 30 28.9 30.4c.5.1 1 .1 1.6.1M64.2 48.9h-33c-10.6-.3-18.9-9.2-18.6-19.8.3-10.1 8.4-18.3 18.5-18.6h33c10.6-.3 19.5 8 19.8 18.6.3 10.6-8 19.5-18.6 19.8-.4 0-.8 0-1.2 0" />
  </svg>
);

const Microsoft365Icon: IconComponent = ({ className }) => (
  <svg
    viewBox="0 0 23 23"
    className={className}
    fill="currentColor"
    role="img"
    aria-label="Microsoft 365"
  >
    <rect x="1" y="1" width="10" height="10" />
    <rect x="12" y="1" width="10" height="10" />
    <rect x="1" y="12" width="10" height="10" />
    <rect x="12" y="12" width="10" height="10" />
  </svg>
);

// Dremio's narwhal, reduced to its silhouette so it takes the surrounding text
// colour like every other source mark. The eye is cut out of the body.
const DremioIcon: IconComponent = ({ className }) => (
  <svg
    viewBox="2.9 -1.9 62 62"
    className={className}
    fill="currentColor"
    role="img"
    aria-label="Dremio"
  >
    <g transform="matrix(1 0 0 -1 6 192)">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M57.8,190.7c-0.5,0.6-1.8,0.6-3.5-0.2l-20.8-10.6c0,0-0.1,0.1-0.1,0.1c-0.4,0.4-0.7,0.7-1.1,1.1 c-0.6,0.5-1.7,1.2-2.4,1.5c-4.5,2.3-9.8,2.1-14.5,0.7c-5.3-1.6-10.3-4.8-14.1-8.8c-1.7-1.8-3.2-3.9-4.4-6.1 c-1.5-2.8-2.4-5.8-2.7-8.9c-0.5-6.1,1.2-14,5.4-18.6c1-1.2,2.1-2.2,3.2-3.3c0.8-0.8,1.7-1.6,2.5-2.5c1.5-1.8,2.3-3.6,3-5.9 l0.1-0.3l0.3,0.2c4.3,3.1,5.9,7.2,2.8,11.8c1.8,1.5,2.7,3.6,2.7,5.9c0,2.2-0.9,4.6-2.8,5.9c0.8,0.3,2,0.9,2.8,1.2 c0-0.7-0.6-1.8-0.1-2.1c1-0.6,4.8,1,6.1,4.4c1.2,0.4,1.9,0.7,3.2,1.2c4.9,2,10.3,4.8,13.3,8.3c1,1.2,3.1,4.7,0.8,5.6 c0.8,0.9,1.3,2.4,1,3.4l17.8,13C57.6,188.5,58.4,190,57.8,190.7z M3.1,146.4c-0.4,2.2,3.4,4.1,5.4,5C8,149.8,7,148.2,5.8,147 C5.2,146.5,3.7,145.1,3.1,146.4z M22.4,174.5c0.7,0.4,1.7,0.1,2.1-0.6c0.4-0.7,0.1-1.6-0.6-2.1c-0.7-0.4-1.7-0.1-2.1,0.6 C21.4,173.2,21.7,174.1,22.4,174.5L22.4,174.5z"
      />
      <path d="M0.9,171c0.7,0.1,1.3-0.4,1.3-1.1c0-0.7-0.6-1.4-1.3-1.5c-0.7-0.1-1.3,0.4-1.2,1.1 C-0.4,170.2,0.2,170.9,0.9,171L0.9,171z M5.2,175.7c0.6,0.1,1.1-0.3,1.1-1c0-0.7-0.5-1.3-1.2-1.4c-0.6-0.1-1.1,0.3-1.1,1C4,175,4.6,175.6,5.2,175.7 L5.2,175.7z M18.1,181.9c0.6,0,1-0.6,0.9-1.2c-0.2-0.6-0.8-1.1-1.4-1.1c-0.6,0-1,0.6-0.9,1.2 C16.8,181.5,17.4,182,18.1,181.9L18.1,181.9z M22,182.6c0.5-0.1,0.8-0.6,0.6-1.1c-0.2-0.5-0.8-0.8-1.3-0.7c-0.5,0.1-0.8,0.6-0.6,1.1 C20.9,182.4,21.5,182.7,22,182.6L22,182.6z M5.2,172.8c0.5,0.1,0.8-0.3,0.8-0.7c0-0.5-0.4-0.9-0.9-1c-0.5-0.1-0.8,0.2-0.8,0.7 C4.4,172.2,4.8,172.7,5.2,172.8L5.2,172.8z M-1.4,167.3c0.5,0.1,0.9-0.3,0.9-0.8c0-0.5-0.4-1-0.9-1.1c-0.5-0.1-0.9,0.3-0.9,0.7 C-2.3,166.7-1.9,167.2-1.4,167.3L-1.4,167.3z" />
    </g>
  </svg>
);

const TableauIcon: IconComponent = ({ className }) => (
  <svg
    viewBox="0 0 100.2 98"
    className={className}
    fill="currentColor"
    role="img"
    aria-label="Tableau"
  >
    <polygon points="65.7 51.8 52 51.8 52 66.8 46.6 66.8 46.6 51.8 32.8 51.8 32.8 46.6 46.6 46.6 46.6 31.6 52 31.6 52 46.6 65.7 46.6" />
    <polygon points="38.2 70.3 25.9 70.3 25.9 56.8 21.3 56.8 21.3 70.3 8.8 70.3 8.8 74.3 21.3 74.3 21.3 87.6 25.9 87.6 25.9 74.3 38.2 74.3" />
    <polygon points="90.7 23 78.3 23 78.3 9.6 73.7 9.6 73.7 23 61.4 23 61.4 27.2 73.7 27.2 73.7 40.5 78.3 40.5 78.3 27.2 90.7 27.2" />
    <polygon points="59.8 84.9 51.5 84.9 51.5 75.6 47.5 75.6 47.5 84.9 39 84.9 39 88.5 47.5 88.5 47.5 98 51.5 98 51.5 88.5 59.8 88.5" />
    <polygon points="38.1 22.9 25.6 22.9 25.6 9.6 21.1 9.6 21.1 22.9 8.6 22.9 8.6 26.9 21.1 26.9 21.1 40.5 25.6 40.5 25.6 26.9 38.1 26.9" />
    <polygon points="100.2 47.4 91.9 47.4 91.9 38.1 87.8 38.1 87.8 47.4 79.4 47.4 79.4 51 87.8 51 87.8 60.3 91.9 60.3 91.9 51 100.2 51" />
    <polygon points="89.9 70.3 77.6 70.3 77.6 56.8 73 56.8 73 70.3 60.6 70.3 60.6 74.3 73 74.3 73 87.6 77.6 87.6 77.6 74.3 89.9 74.3" />
    <polygon points="59.2 9.3 50.9 9.3 50.9 0 47.9 0 47.9 9.3 39.6 9.3 39.6 12.1 47.9 12.1 47.9 21.2 50.9 21.2 50.9 12.1 59.2 12.1" />
    <polygon points="19.6 47.8 11.3 47.8 11.3 38.7 8.3 38.7 8.3 47.8 0 47.8 0 50.6 8.3 50.6 8.3 59.7 11.3 59.7 11.3 50.6 19.6 50.6" />
  </svg>
);

const SOURCE_SIMPLE_ICON_BY_INGESTION_TYPE: Record<
  ApiSourceType,
  SimpleIcon | null
> = {
  [CreateSourceDtoTypeEnum.Sandbox]: null,
  [CreateSourceDtoTypeEnum.Wordpress]: siWordpress,
  [CreateSourceDtoTypeEnum.Slack]: null,
  [CreateSourceDtoTypeEnum.S3CompatibleStorage]: null,
  [CreateSourceDtoTypeEnum.AzureBlobStorage]: null,
  [CreateSourceDtoTypeEnum.GoogleCloudStorage]: null,
  [CreateSourceDtoTypeEnum.Postgresql]: siPostgresql,
  [CreateSourceDtoTypeEnum.Mysql]: siMysql,
  [CreateSourceDtoTypeEnum.Mssql]: null,
  [CreateSourceDtoTypeEnum.Oracle]: null,
  [CreateSourceDtoTypeEnum.Hive]: siApachehive,
  [CreateSourceDtoTypeEnum.Databricks]: siDatabricks,
  [CreateSourceDtoTypeEnum.Snowflake]: siSnowflake,
  [CreateSourceDtoTypeEnum.Dremio]: null,
  [CreateSourceDtoTypeEnum.Mongodb]: siMongodb,
  [CreateSourceDtoTypeEnum.Neo4J]: siNeo4j,
  [CreateSourceDtoTypeEnum.Powerbi]: null,
  [CreateSourceDtoTypeEnum.Tableau]: null,
  [CreateSourceDtoTypeEnum.Confluence]: siConfluence,
  [CreateSourceDtoTypeEnum.Jira]: siJira,
  [CreateSourceDtoTypeEnum.Servicedesk]: null,
  [CreateSourceDtoTypeEnum.Sqlite]: null,
  [CreateSourceDtoTypeEnum.Notion]: siNotion,
  [CreateSourceDtoTypeEnum.Email]: null,
  [CreateSourceDtoTypeEnum.Youtube]: siYoutube,
  [CreateSourceDtoTypeEnum.Reddit]: siReddit,
  [CreateSourceDtoTypeEnum.DeltaLake]: null,
  [CreateSourceDtoTypeEnum.Iceberg]: null,
  [CreateSourceDtoTypeEnum.Kafka]: siApachekafka,
  [CreateSourceDtoTypeEnum.Elasticsearch]: siElasticsearch,
  [CreateSourceDtoTypeEnum.Opensearch]: siOpensearch,
  [CreateSourceDtoTypeEnum.Meilisearch]: siMeilisearch,
  [CreateSourceDtoTypeEnum.LocalFolder]: null,
  [CreateSourceDtoTypeEnum.Microsoft365]: null,
  [CreateSourceDtoTypeEnum.GoogleWorkspace]: siGoogledrive,
  [CreateSourceDtoTypeEnum.Dropbox]: siDropbox,
  [CreateSourceDtoTypeEnum.HuggingFace]: siHuggingface,
  [CreateSourceDtoTypeEnum.Git]: siGit,
  // No vendor logo: a custom connector is whatever its author made it.
  [CreateSourceDtoTypeEnum.Custom]: null,
};

const SOURCE_CUSTOM_ICON_BY_INGESTION_TYPE: Partial<
  Record<ApiSourceType, IconComponent>
> = {
  [CreateSourceDtoTypeEnum.Slack]: SlackIcon,
  [CreateSourceDtoTypeEnum.Oracle]: OracleIcon,
  [CreateSourceDtoTypeEnum.Tableau]: TableauIcon,
  [CreateSourceDtoTypeEnum.Dremio]: DremioIcon,
  [CreateSourceDtoTypeEnum.Microsoft365]: Microsoft365Icon,
};

export const MISSING_SIMPLE_ICON_SOURCE_TYPES = Object.values(
  CreateSourceDtoTypeEnum,
).filter(
  (sourceType) =>
    !SOURCE_SIMPLE_ICON_BY_INGESTION_TYPE[sourceType] &&
    !SOURCE_CUSTOM_ICON_BY_INGESTION_TYPE[sourceType],
);

const SOURCE_ICON_BY_INGESTION_TYPE: Record<ApiSourceType, IconComponent> = {
  [CreateSourceDtoTypeEnum.Sandbox]: FlaskConical,
  [CreateSourceDtoTypeEnum.Wordpress]: simpleIconComponent(siWordpress),
  [CreateSourceDtoTypeEnum.Slack]: SlackIcon,
  [CreateSourceDtoTypeEnum.S3CompatibleStorage]: Cloud,
  [CreateSourceDtoTypeEnum.AzureBlobStorage]: Cloud,
  [CreateSourceDtoTypeEnum.GoogleCloudStorage]: Cloud,
  [CreateSourceDtoTypeEnum.Postgresql]: simpleIconComponent(siPostgresql),
  [CreateSourceDtoTypeEnum.Mysql]: simpleIconComponent(siMysql),
  [CreateSourceDtoTypeEnum.Mssql]: FALLBACK_SOURCE_ICON,
  [CreateSourceDtoTypeEnum.Oracle]: OracleIcon,
  [CreateSourceDtoTypeEnum.Hive]: simpleIconComponent(siApachehive),
  [CreateSourceDtoTypeEnum.Databricks]: simpleIconComponent(siDatabricks),
  [CreateSourceDtoTypeEnum.Snowflake]: simpleIconComponent(siSnowflake),
  [CreateSourceDtoTypeEnum.Dremio]: DremioIcon,
  [CreateSourceDtoTypeEnum.Mongodb]: simpleIconComponent(siMongodb),
  [CreateSourceDtoTypeEnum.Neo4J]: simpleIconComponent(siNeo4j),
  [CreateSourceDtoTypeEnum.Powerbi]: FALLBACK_SOURCE_ICON,
  [CreateSourceDtoTypeEnum.Tableau]: TableauIcon,
  [CreateSourceDtoTypeEnum.Confluence]: simpleIconComponent(siConfluence),
  [CreateSourceDtoTypeEnum.Jira]: simpleIconComponent(siJira),
  [CreateSourceDtoTypeEnum.Servicedesk]: Monitor,
  [CreateSourceDtoTypeEnum.Sqlite]: FALLBACK_SOURCE_ICON,
  [CreateSourceDtoTypeEnum.Notion]: simpleIconComponent(siNotion),
  [CreateSourceDtoTypeEnum.Email]: Mail,
  [CreateSourceDtoTypeEnum.Youtube]: simpleIconComponent(siYoutube),
  [CreateSourceDtoTypeEnum.Reddit]: simpleIconComponent(siReddit),
  [CreateSourceDtoTypeEnum.DeltaLake]: Layers,
  [CreateSourceDtoTypeEnum.Iceberg]: Layers,
  [CreateSourceDtoTypeEnum.Kafka]: simpleIconComponent(siApachekafka),
  [CreateSourceDtoTypeEnum.Elasticsearch]:
    simpleIconComponent(siElasticsearch),
  [CreateSourceDtoTypeEnum.Opensearch]: simpleIconComponent(siOpensearch),
  [CreateSourceDtoTypeEnum.Meilisearch]:
    simpleIconComponent(siMeilisearch),
  [CreateSourceDtoTypeEnum.LocalFolder]: Folder,
  [CreateSourceDtoTypeEnum.Microsoft365]: Microsoft365Icon,
  [CreateSourceDtoTypeEnum.GoogleWorkspace]:
    simpleIconComponent(siGoogledrive),
  [CreateSourceDtoTypeEnum.Dropbox]: simpleIconComponent(siDropbox),
  [CreateSourceDtoTypeEnum.HuggingFace]:
    simpleIconComponent(siHuggingface),
  [CreateSourceDtoTypeEnum.Git]: simpleIconComponent(siGit),
  [CreateSourceDtoTypeEnum.Custom]: Code2,
};

const SOURCE_ICON_BY_INGESTION_TYPE_LOWERCASE: Record<string, IconComponent> =
  Object.values(CreateSourceDtoTypeEnum).reduce(
    (acc, sourceType) => {
      acc[sourceType.toLowerCase()] = SOURCE_ICON_BY_INGESTION_TYPE[sourceType];
      return acc;
    },
    {} as Record<string, IconComponent>,
  );

export const SOURCE_ICON_BY_TYPE = {
  CROWD: BookOpen,
  BITBUCKET: simpleIconComponent(siBitbucket),
  XRAY: Monitor,
  GOOGLE_DRIVE: simpleIconComponent(siGoogledrive),
  GOOGLE_SHEETS: simpleIconComponent(siGooglesheets),
  GOOGLE_DOCS: simpleIconComponent(siGoogledocs),
  GOOGLE_SLIDES: simpleIconComponent(siGoogleslides),
  ...SOURCE_ICON_BY_INGESTION_TYPE,
  ...SOURCE_ICON_BY_INGESTION_TYPE_LOWERCASE,
  CUSTOM: Settings,
  filesystem: Folder,
  github: simpleIconComponent(siGithub),
  s3: Cloud,
  database: Database,
  custom: Settings,
} as const;

export type IngestionSourceType = ApiSourceType;

const INGESTION_SOURCE_TYPE_SET = new Set<string>(
  Object.values(CreateSourceDtoTypeEnum),
);

export function isIngestionSourceType(
  source: string,
): source is IngestionSourceType {
  return INGESTION_SOURCE_TYPE_SET.has(source);
}

export type SourceType = keyof typeof SOURCE_ICON_BY_TYPE;

export interface SourceIconProps extends React.HTMLAttributes<HTMLDivElement> {
  source: SourceType | string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

function resolveSourceType(source: string): SourceType {
  if (source in SOURCE_ICON_BY_TYPE) return source as SourceType;

  const upper = source.toUpperCase();
  if (upper in SOURCE_ICON_BY_TYPE) return upper as SourceType;

  const lower = source.toLowerCase();
  if (lower in SOURCE_ICON_BY_TYPE) return lower as SourceType;

  return "filesystem";
}

export function getSourceTypeIcon(source?: string | null) {
  if (!source) return SOURCE_ICON_BY_TYPE.filesystem;
  return SOURCE_ICON_BY_TYPE[resolveSourceType(source)];
}

function SourceIcon({
  source,
  size = "md",
  className,
  ...props
}: SourceIconProps) {
  // getSourceTypeIcon returns a stable component reference from SOURCE_ICON_BY_TYPE
  // (a static lookup table). The variable is capitalised so React treats it as a
  // component; it is not created anew on each render.
  const Icon = getSourceTypeIcon(source);

  return (
    <div className={cn("inline-flex", className)} {...props}>
      <Icon className={cn(sizeClasses[size], "text-muted-foreground")} />
    </div>
  );
}

export { SourceIcon };

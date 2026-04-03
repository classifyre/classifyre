import * as React from "react";
import {
  siApachehive,
  siBitbucket,
  siConfluence,
  siDatabricks,
  siGithub,
  siGoogledocs,
  siGoogledrive,
  siGooglesheets,
  siGoogleslides,
  siJira,
  siMongodb,
  siMysql,
  siPostgresql,
  siSnowflake,
  siWordpress,
  type SimpleIcon,
} from "simple-icons";
import {
  CreateSourceDtoTypeEnum,
  type CreateSourceDtoTypeEnum as ApiSourceType,
} from "@workspace/api-client/types";
import {
  BookOpen,
  Cloud,
  Database,
  Folder,
  Monitor,
  Settings,
} from "lucide-react";
import { cn } from "../lib/utils";

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

function createSimpleIconComponent(icon: SimpleIcon): IconComponent {
  return function SimpleIconGlyph({ className }) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="currentColor"
        role="img"
        aria-label={icon.title}
      >
        <path d={icon.path} />
      </svg>
    );
  };
}

const SOURCE_SIMPLE_ICON_BY_INGESTION_TYPE: Record<
  ApiSourceType,
  SimpleIcon | null
> = {
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
  [CreateSourceDtoTypeEnum.Mongodb]: siMongodb,
  [CreateSourceDtoTypeEnum.Powerbi]: null,
  [CreateSourceDtoTypeEnum.Tableau]: null,
  [CreateSourceDtoTypeEnum.Confluence]: siConfluence,
  [CreateSourceDtoTypeEnum.Jira]: siJira,
  [CreateSourceDtoTypeEnum.Servicedesk]: null,
};

const SOURCE_CUSTOM_ICON_BY_INGESTION_TYPE: Partial<
  Record<ApiSourceType, IconComponent>
> = {
  [CreateSourceDtoTypeEnum.Slack]: SlackIcon,
  [CreateSourceDtoTypeEnum.Oracle]: OracleIcon,
  [CreateSourceDtoTypeEnum.Tableau]: TableauIcon,
};

export const MISSING_SIMPLE_ICON_SOURCE_TYPES = Object.values(
  CreateSourceDtoTypeEnum,
).filter(
  (sourceType) =>
    !SOURCE_SIMPLE_ICON_BY_INGESTION_TYPE[sourceType] &&
    !SOURCE_CUSTOM_ICON_BY_INGESTION_TYPE[sourceType],
);

const SOURCE_ICON_BY_INGESTION_TYPE: Record<ApiSourceType, IconComponent> = {
  [CreateSourceDtoTypeEnum.Wordpress]: createSimpleIconComponent(siWordpress),
  [CreateSourceDtoTypeEnum.Slack]: SlackIcon,
  [CreateSourceDtoTypeEnum.S3CompatibleStorage]: Cloud,
  [CreateSourceDtoTypeEnum.AzureBlobStorage]: Cloud,
  [CreateSourceDtoTypeEnum.GoogleCloudStorage]: Cloud,
  [CreateSourceDtoTypeEnum.Postgresql]: createSimpleIconComponent(siPostgresql),
  [CreateSourceDtoTypeEnum.Mysql]: createSimpleIconComponent(siMysql),
  [CreateSourceDtoTypeEnum.Mssql]: FALLBACK_SOURCE_ICON,
  [CreateSourceDtoTypeEnum.Oracle]: OracleIcon,
  [CreateSourceDtoTypeEnum.Hive]: createSimpleIconComponent(siApachehive),
  [CreateSourceDtoTypeEnum.Databricks]: createSimpleIconComponent(siDatabricks),
  [CreateSourceDtoTypeEnum.Snowflake]: createSimpleIconComponent(siSnowflake),
  [CreateSourceDtoTypeEnum.Mongodb]: createSimpleIconComponent(siMongodb),
  [CreateSourceDtoTypeEnum.Powerbi]: FALLBACK_SOURCE_ICON,
  [CreateSourceDtoTypeEnum.Tableau]: TableauIcon,
  [CreateSourceDtoTypeEnum.Confluence]: createSimpleIconComponent(siConfluence),
  [CreateSourceDtoTypeEnum.Jira]: createSimpleIconComponent(siJira),
  [CreateSourceDtoTypeEnum.Servicedesk]: Monitor,
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
  BITBUCKET: createSimpleIconComponent(siBitbucket),
  XRAY: Monitor,
  GOOGLE_DRIVE: createSimpleIconComponent(siGoogledrive),
  GOOGLE_SHEETS: createSimpleIconComponent(siGooglesheets),
  GOOGLE_DOCS: createSimpleIconComponent(siGoogledocs),
  GOOGLE_SLIDES: createSimpleIconComponent(siGoogleslides),
  ...SOURCE_ICON_BY_INGESTION_TYPE,
  ...SOURCE_ICON_BY_INGESTION_TYPE_LOWERCASE,
  CUSTOM: Settings,
  filesystem: Folder,
  github: createSimpleIconComponent(siGithub),
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
  const Icon = getSourceTypeIcon(source);

  return (
    <div className={cn("inline-flex", className)} {...props}>
      <Icon className={cn(sizeClasses[size], "text-muted-foreground")} />
    </div>
  );
}

export { SourceIcon };

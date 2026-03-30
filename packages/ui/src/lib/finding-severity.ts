export const FINDING_SEVERITY_COLOR_BY_LEVEL = {
  critical: "#ff2b2b",
  high: "#ff6b35",
  medium: "#f5a623",
  low: "#0ea5e9",
  info: "#7c7c7c",
} as const;

export const FINDING_SEVERITY_COLOR_BY_ENUM = {
  CRITICAL: FINDING_SEVERITY_COLOR_BY_LEVEL.critical,
  HIGH: FINDING_SEVERITY_COLOR_BY_LEVEL.high,
  MEDIUM: FINDING_SEVERITY_COLOR_BY_LEVEL.medium,
  LOW: FINDING_SEVERITY_COLOR_BY_LEVEL.low,
  INFO: FINDING_SEVERITY_COLOR_BY_LEVEL.info,
} as const;

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

/**
 * Each severity as text on a card. The colours above are fills and too light
 * to read on white, so each has a darker ink in light mode and a lifted one in
 * dark mode. SeverityBadge prints with these.
 */
export const FINDING_SEVERITY_INK = {
  critical: "text-[#b91c1c] dark:text-[#f87171]",
  high: "text-[#c2410c] dark:text-[#fb923c]",
  medium: "text-[#a16207] dark:text-[#fbbf24]",
  low: "text-[#1d4ed8] dark:text-[#60a5fa]",
  info: "text-[#78716c] dark:text-[#a8a29e]",
} as const;

/**
 * Escalation has no colour of its own: an escalated finding is shown in
 * HIGH's colour, on the board and in every list.
 */
export const ESCALATION_SEVERITY = "high" as const;

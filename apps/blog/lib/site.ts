import { softwareVersion } from "@workspace/ui/lib/software-version";
import {
  helmChartRef,
  marketingSiteUrl,
  privacyPolicyUrl,
  releasesLatestUrl,
} from "@workspace/ui/lib/site-links";

/**
 * Marketing-site constants shared by the landing page and its sub-pages.
 * Anything that appears on more than one page lives here so a URL or a
 * version-pinned command is only ever written once.
 */

/** The GitHub release page, shared with the docs site's install pages. */
export { releasesLatestUrl };
export const repoUrl = "https://github.com/classifyre/classifyre";
export const demoUrl = "https://demo.classifyre.com/";
export const enterpriseContactEmail = "contact@classifyre.com";

/**
 * Canonical origin of this site. Shared with the docs site and the app, which
 * link the privacy policy absolutely — see `@workspace/ui/lib/site-links`.
 */
export { marketingSiteUrl, privacyPolicyUrl };

/** Deep content lives on the docs site — marketing pages only point at it. */
export const docs = {
  root: "https://docs.classifyre.com/",
  howItWorks: "https://docs.classifyre.com/how-it-works/",
  inTheApp: "https://docs.classifyre.com/how-it-works/in-the-app/",
  ranking: "https://docs.classifyre.com/how-it-works/ranking-and-semantics/",
  workspaces: "https://docs.classifyre.com/how-it-works/workspaces/",
  autopilot: "https://docs.classifyre.com/how-it-works/autopilot/",
  glossary: "https://docs.classifyre.com/how-it-works/glossary/",
  duplicates: "https://docs.classifyre.com/duplicates/",
  duplicatesGlossary: "https://docs.classifyre.com/duplicates/glossary/",
  cases: "https://docs.classifyre.com/investigations/cases/",
  detectors: "https://docs.classifyre.com/detectors/",
  customDetectors: "https://docs.classifyre.com/detectors/custom-detectors/",
  preBuiltDetectors: "https://docs.classifyre.com/detectors/pre-built/",
  sources: "https://docs.classifyre.com/sources/",
  sourceConfiguration: "https://docs.classifyre.com/sources/configuration/",
  sourceTesting: "https://docs.classifyre.com/sources/testing/",
  sampling: "https://docs.classifyre.com/sources/sampling/",
  deployment: "https://docs.classifyre.com/deployment/",
  kubernetes: "https://docs.classifyre.com/deployment/kubernetes/",
  database: "https://docs.classifyre.com/deployment/database/",
  storage: "https://docs.classifyre.com/deployment/storage/",
  upgrades: "https://docs.classifyre.com/deployment/upgrade-and-versioning/",
  telemetry: "https://docs.classifyre.com/deployment/telemetry/",
  aiProviders: "https://docs.classifyre.com/settings/ai-providers/",
  mcpServer: "https://docs.classifyre.com/settings/mcp-server/",
  dataExport: "https://docs.classifyre.com/data-export/",
} as const;

/** Marketing routes that live on this site rather than the docs site. */
export const routes = {
  home: "/",
  download: "/download",
  sources: "/sources",
  editions: "/open-source-vs-enterprise",
  madeInEurope: "/made-in-europe",
  blog: "/blog",
  privacy: "/privacy",
} as const;

export { helmChartRef };

export const helmInstallCommand = [
  "helm install classifyre \\",
  `  ${helmChartRef} \\`,
  `  --version ${softwareVersion}`,
];

export { softwareVersion };

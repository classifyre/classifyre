/**
 * Public Classifyre URLs that more than one app has to know.
 *
 * The privacy policy is published once, on the marketing site, and linked to
 * from the docs site and from app deployments — so the origin cannot live in a
 * per-app env var without the three drifting apart.
 */

export const marketingSiteUrl = "https://www.classifyre.com";
export const docsSiteUrl = "https://docs.classifyre.com";
export const demoSiteUrl = "https://demo.classifyre.com";

/** Absolute URL of the privacy & cookie policy (apps/blog/app/privacy). */
export const privacyPolicyUrl = `${marketingSiteUrl}/privacy/`;

/**
 * The two ways to get an own instance. Linked from the app itself (the demo
 * deployment turns every blocked action into a pointer at these) as well as
 * from the marketing site, so they belong here rather than in either app.
 */
export const desktopDownloadUrl = `${marketingSiteUrl}/download/`;
export const helmDeploymentUrl = `${docsSiteUrl}/deployment/kubernetes/`;

export const repositoryUrl = "https://github.com/classifyre/classifyre";
export const contactEmail = "contact@classifyre.com";

/**
 * Marketing-site routes as *paths*, not URLs.
 *
 * The shared footer renders the same set of links on the marketing site (where
 * they resolve same-origin) and on the docs site (where they have to be
 * prefixed with the marketing origin), so the paths are written once here and
 * the origin is applied by the caller. `trailingSlash` is on for both sites.
 */
export const marketingPaths = {
  home: "/",
  download: "/download/",
  sources: "/sources/",
  editions: "/open-source-vs-enterprise/",
  madeInEurope: "/made-in-europe/",
  blog: "/blog/",
  privacy: "/privacy/",
} as const;

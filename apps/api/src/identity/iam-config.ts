/**
 * Sign-in configuration, from the environment the Helm chart sets
 * (`classifyre.iam.env` in helm/classifyre/templates/_helpers.tpl).
 */
/** `appOrigin` value that accepts cookie writes from any origin (development only). */
export const ANY_APP_ORIGIN = '*';

export interface IamConfig {
  /** The token issuer, at the public URL browsers use. */
  issuerUrl: string;
  /** Development only: tokens from this realm under any host are accepted. */
  anyIssuerHost?: boolean;
  /** The same realm at the in-cluster URL, for keys and admin lookups. */
  internalRealmUrl: string;
  /** `<internal>/admin/realms/<realm>`. */
  adminUrl: string;
  realm: string;
  /** Tokens must be meant for this client. */
  audience: string;
  apiClientId: string;
  apiClientSecret: string;
  /**
   * Alias of the first tenant, made with its admins at boot. People who have
   * not signed in read its public workspaces.
   */
  bootstrapTenantAlias: string;
  /** Origin of the Classifyre app; cookie-signed writes must come from it. */
  appOrigin: string | null;
}

/**
 * Sign-in is always on (docs/prd/IAM-access-management.md §1). A setup that
 * misses one of its keys is refused at boot rather than half-working.
 */
export function assertIamAllowed(env: NodeJS.ProcessEnv = process.env): void {
  // Without the key, internal-only routes (scan callbacks) would be open to
  // every signed-in person; the chart and the all-in-one image always set one.
  if (!env.CLASSIFYRE_INTERNAL_KEY?.trim()) {
    throw new Error(
      'CLASSIFYRE_INTERNAL_KEY must be set, so internal-only routes stay closed to signed-in people.',
    );
  }
  // Each tenant's database has its own role, whose password comes from it.
  if (!env.CLASSIFYRE_TENANT_DATABASE_KEY?.trim()) {
    throw new Error(
      'CLASSIFYRE_TENANT_DATABASE_KEY must be set: each tenant has its own database, logged in with a password made from it.',
    );
  }
}

/** Throws when the identity server is not fully configured. */
export function readIamConfig(env: NodeJS.ProcessEnv = process.env): IamConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) {
      throw new Error(`Sign-in needs ${name} to be set.`);
    }
    return value;
  };
  const realm = required('IAM_REALM');
  const internal = required('IAM_INTERNAL_URL').replace(/\/+$/, '');
  const anyIssuerHost = env.IAM_ISSUER_ANY_HOST === 'true';
  // It widens three checks at once (issuer host, cookie-write origin, and with
  // the chart the identity server's own host), so a production process must
  // not start with it, whatever the chart's values say.
  if (anyIssuerHost && env.NODE_ENV === 'production') {
    throw new Error(
      'IAM_ISSUER_ANY_HOST is for development only (iam.dynamicHostname) and must not be set when NODE_ENV=production.',
    );
  }
  return {
    issuerUrl: required('IAM_ISSUER_URL').replace(/\/+$/, ''),
    anyIssuerHost,
    internalRealmUrl: `${internal}/realms/${realm}`,
    adminUrl: `${internal}/admin/realms/${realm}`,
    realm,
    audience: env.IAM_AUDIENCE?.trim() || 'classifyre-api',
    apiClientId: required('IAM_API_CLIENT_ID'),
    apiClientSecret: required('IAM_API_CLIENT_SECRET'),
    bootstrapTenantAlias: env.IAM_BOOTSTRAP_TENANT?.trim() || 'default',
    // Development only (`iam.dynamicHostname`): the app is opened by several
    // addresses, so any origin counts as the app's own (see ANY_APP_ORIGIN).
    appOrigin: anyIssuerHost ? ANY_APP_ORIGIN : originOf(env.IAM_APP_URL),
  };
}

function originOf(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

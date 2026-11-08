/**
 * Sign-in configuration, from the environment the Helm chart sets
 * (`classifyre.iam.env` in helm/classifyre/templates/_helpers.tpl).
 */
export interface IamConfig {
  /** The token issuer, at the public URL browsers use. */
  issuerUrl: string;
  /** The same realm at the in-cluster URL, for keys and admin lookups. */
  internalRealmUrl: string;
  /** `<internal>/admin/realms/<realm>`. */
  adminUrl: string;
  realm: string;
  /** Tokens must be meant for this client. */
  audience: string;
  apiClientId: string;
  apiClientSecret: string;
  /** Alias of the tenant existing workspaces move to when sign-in is turned on. */
  bootstrapTenantAlias: string;
  /**
   * Alias of the public tenant: people who have not signed in read its
   * workspaces (docs/prd/IAM step 8e). Null: everyone must sign in.
   */
  publicTenantAlias: string | null;
  /** Origin of the Classifyre app; cookie-signed writes must come from it. */
  appOrigin: string | null;
}

export function iamEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.IAM_ENABLED === 'true';
}

/**
 * The all-in-one Docker image never uses sign-in (docs/prd §2 H2). A setup
 * that asks for both is refused at boot rather than half-working.
 */
export function assertIamAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (iamEnabled(env) && (env.ENVIRONMENT ?? '').toLowerCase() === 'docker') {
    throw new Error(
      'IAM_ENABLED=true is not supported in the all-in-one Docker image (ENVIRONMENT=docker). Use the Helm chart for sign-in, or unset IAM_ENABLED.',
    );
  }
  // Without the key, internal-only routes (scan callbacks) would be open to
  // every signed-in person; the chart always sets one.
  if (iamEnabled(env) && !env.CLASSIFYRE_INTERNAL_KEY?.trim()) {
    throw new Error(
      'IAM_ENABLED=true needs CLASSIFYRE_INTERNAL_KEY to be set, so internal-only routes stay closed to signed-in people.',
    );
  }
  // Each tenant's database has its own role, whose password comes from it.
  if (iamEnabled(env) && !env.CLASSIFYRE_TENANT_DATABASE_KEY?.trim()) {
    throw new Error(
      'IAM_ENABLED=true needs CLASSIFYRE_TENANT_DATABASE_KEY to be set: each tenant has its own database, logged in with a password made from it.',
    );
  }
}

/** Null without sign-in. Throws when sign-in is on but incompletely configured. */
export function readIamConfig(
  env: NodeJS.ProcessEnv = process.env,
): IamConfig | null {
  if (!iamEnabled(env)) return null;
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) {
      throw new Error(`IAM_ENABLED=true needs ${name} to be set.`);
    }
    return value;
  };
  const realm = required('IAM_REALM');
  const internal = required('IAM_INTERNAL_URL').replace(/\/+$/, '');
  return {
    issuerUrl: required('IAM_ISSUER_URL').replace(/\/+$/, ''),
    internalRealmUrl: `${internal}/realms/${realm}`,
    adminUrl: `${internal}/admin/realms/${realm}`,
    realm,
    audience: env.IAM_AUDIENCE?.trim() || 'classifyre-api',
    apiClientId: required('IAM_API_CLIENT_ID'),
    apiClientSecret: required('IAM_API_CLIENT_SECRET'),
    bootstrapTenantAlias: bootstrapTenant(env),
    publicTenantAlias: publicTenant(env),
    appOrigin: originOf(env.IAM_APP_URL),
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

function publicTenant(env: NodeJS.ProcessEnv): string | null {
  const alias = env.IAM_PUBLIC_TENANT?.trim();
  if (!alias) return null;
  if (alias === 'local') {
    throw new Error(
      "IAM_PUBLIC_TENANT cannot be 'local': that name is kept for workspaces made without sign-in.",
    );
  }
  return alias;
}

/** `local` is the reserved tenant of workspaces made without sign-in. */
function bootstrapTenant(env: NodeJS.ProcessEnv): string {
  const alias = env.IAM_BOOTSTRAP_TENANT?.trim() || 'default';
  if (alias === 'local') {
    throw new Error(
      "IAM_BOOTSTRAP_TENANT cannot be 'local': that name is kept for workspaces made without sign-in.",
    );
  }
  return alias;
}

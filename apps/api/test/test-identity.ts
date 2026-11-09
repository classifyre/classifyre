import { randomUUID } from 'node:crypto';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { Pool } from 'pg';
import type { Actor } from '../src/identity/actor';
import {
  ACCESS_POLICY,
  type AccessPolicy,
} from '../src/identity/access-policy';
import { CAPABILITY_IDS } from '../src/identity/capabilities';
import type { IamConfig } from '../src/identity/iam-config';
import { IAM_CONFIG, IDENTITY } from '../src/identity/identity.tokens';
import {
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from '../src/registry/namespace-registry.sql';

/**
 * Sign-in is always on, so the integration suite runs as one signed-in
 * person who may do everything, without an identity server: the identity
 * service, its config and the access policy are replaced. Writes are
 * attributed to {@link TEST_ACTOR_REF}, as they would be to a real person.
 */
export const TEST_ACTOR_REF = 'user:e2e-tester';
export const TEST_TENANT_ALIAS = 'e2e';
export const TEST_OWNER_GROUP = 'e2e-owners';

const actor: Actor = {
  id: TEST_ACTOR_REF,
  displayName: 'E2E Tester',
  kind: 'person',
  via: 'oidc',
  ref: TEST_ACTOR_REF,
};
const everything = new Set(CAPABILITY_IDS);

const config: IamConfig = {
  issuerUrl: 'http://identity.invalid/realms/e2e',
  internalRealmUrl: 'http://identity.invalid/realms/e2e',
  adminUrl: 'http://identity.invalid/admin/realms/e2e',
  realm: 'e2e',
  audience: 'classifyre-api',
  apiClientId: 'classifyre-api',
  apiClientSecret: 'e2e',
  bootstrapTenantAlias: TEST_TENANT_ALIAS,
  publicTenantAlias: null,
  appOrigin: null,
};

const allowAll: AccessPolicy = {
  check: () => ({ allow: true }),
  capabilities: () => everything,
};

export function signedInAsTester(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  const principal = {
    sub: 'e2e-tester',
    actor,
    via: 'bearer',
    visitor: false,
    grants: [],
    groupIds: new Set([TEST_OWNER_GROUP]),
  };
  const identity = {
    config,
    authenticate: (request: { classifyrePrincipal?: unknown }) => {
      request.classifyrePrincipal = principal;
      return Promise.resolve(principal);
    },
    authenticateOperator: () => Promise.resolve(null),
    tenantCapabilities: () => everything,
    capabilitiesIn: () => Promise.resolve(everything),
    bootstrap: () => Promise.resolve(),
  };
  return builder
    .overrideProvider(IAM_CONFIG)
    .useValue(config)
    .overrideProvider(IDENTITY)
    .useValue(identity)
    .overrideProvider(ACCESS_POLICY)
    .useValue(allowAll);
}

/** The suite's tenant in the control database, made on first use. */
export async function ensureTestTenant(): Promise<string> {
  const pool = new Pool({
    connectionString: publicConnectionString(),
    options: PUBLIC_SEARCH_PATH_OPTION,
    max: 1,
  });
  try {
    await pool.query(
      `INSERT INTO iam_tenants (id, alias, name, org_id)
       VALUES ($1, $2, 'E2E tests', $3)
       ON CONFLICT (alias) DO NOTHING`,
      [randomUUID(), TEST_TENANT_ALIAS, `org-${TEST_TENANT_ALIAS}`],
    );
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM iam_tenants WHERE alias = $1',
      [TEST_TENANT_ALIAS],
    );
    return rows[0].id;
  } finally {
    await pool.end();
  }
}

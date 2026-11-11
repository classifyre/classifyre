/**
 * Tenants and grants (docs/prd/IAM-access-management.md §5), next to the
 * namespace registry in `public`. Idempotent DDL, run at boot right after
 * {@link REGISTRY_TABLE_DDL} under the same migration lock.
 *
 * Sign-in is always on, so every workspace belongs to a real tenant. The
 * `local` tenant survives only in the open database of installs that ran
 * without sign-in, as the source of `admin workspaces copy --to-tenant`.
 */
export const LOCAL_TENANT_ID = '00000000-0000-4000-8000-0000000000aa';

/**
 * The open database's tenant columns, run before {@link IAM_TABLES_DDL} when
 * an operator copies its workspaces into a tenant: an install from before
 * sign-in existed has none of them yet.
 */
export const OPEN_DATABASE_DDL = `
CREATE TABLE IF NOT EXISTS public.iam_tenants (
  id         uuid PRIMARY KEY,
  alias      text NOT NULL UNIQUE,
  name       text NOT NULL,
  org_id     text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.iam_tenants (id, alias, name)
VALUES ('${LOCAL_TENANT_ID}', 'local', 'Local')
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.namespaces
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.iam_tenants (id);
UPDATE public.namespaces SET tenant_id = '${LOCAL_TENANT_ID}' WHERE tenant_id IS NULL;
ALTER TABLE public.namespace_categories
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.iam_tenants (id) ON DELETE CASCADE;
UPDATE public.namespace_categories SET tenant_id = '${LOCAL_TENANT_ID}'
 WHERE tenant_id IS NULL AND id <> '00000000-0000-4000-8000-000000000001';
`;

export const IAM_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS public.iam_tenants (
  id         uuid PRIMARY KEY,
  -- The organization's alias in the identity server.
  alias      text NOT NULL UNIQUE,
  name       text NOT NULL,
  -- The organization's id in the identity server.
  org_id     text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- When the tenant's 'admins' group got Tenant admin, so the bootstrap gives it
-- once and a tenant admin can take it away again.
ALTER TABLE public.iam_tenants
  ADD COLUMN IF NOT EXISTS admins_granted_at timestamptz;
-- Set by operators on the Platform page (docs/prd/TEN §4.7). Suspended: its
-- people and their agents are refused, data kept. Deleted: its organization
-- is gone; the row stays so the alias is never handed out again and the
-- activity and soft-deleted workspaces keep their tenant.
ALTER TABLE public.iam_tenants
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE public.iam_tenants
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
-- The tenant's own database (docs/prd/TEN §4.1), made before its first
-- workspace. The last upgrade of its workspaces: a tenant whose upgrade
-- failed answers 503 on its own while the others keep working (§4.6).
ALTER TABLE public.iam_tenants
  ADD COLUMN IF NOT EXISTS database_name text;
ALTER TABLE public.iam_tenants
  ADD COLUMN IF NOT EXISTS database_ready_at timestamptz;
ALTER TABLE public.iam_tenants
  ADD COLUMN IF NOT EXISTS migrated_at timestamptz;
ALTER TABLE public.iam_tenants
  ADD COLUMN IF NOT EXISTS migration_error text;

-- A workspace belongs to exactly one tenant and is owned by exactly one of
-- its groups (an organization group id in the identity server).
ALTER TABLE public.namespaces
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.iam_tenants (id);
ALTER TABLE public.namespaces
  ALTER COLUMN tenant_id DROP DEFAULT,
  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.namespaces
  ADD COLUMN IF NOT EXISTS owner_group_id text;
CREATE INDEX IF NOT EXISTS namespaces_tenant_idx ON public.namespaces (tenant_id);

-- A grant gives a group a role on a scope: the whole tenant, every workspace
-- a group owns, or one workspace. Grants only add up. Access always goes to
-- groups; people get it by being in them (IAM step 8f).
CREATE TABLE IF NOT EXISTS public.iam_grants (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.iam_tenants (id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type = 'group'),
  -- Organization group id.
  subject_id   text NOT NULL,
  role_key     text NOT NULL,
  scope_type   text NOT NULL CHECK (scope_type IN ('tenant', 'group', 'workspace')),
  -- Tenant id, owner group id, or namespace id.
  scope_id     text NOT NULL,
  expires_at   timestamptz,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subject_type, subject_id, role_key, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS iam_grants_subject_idx
  ON public.iam_grants (tenant_id, subject_type, subject_id);
-- Grants to one person, which earlier builds allowed, are gone.
DELETE FROM public.iam_grants WHERE subject_type <> 'group';
ALTER TABLE public.iam_grants DROP CONSTRAINT IF EXISTS iam_grants_subject_type_check;
ALTER TABLE public.iam_grants
  ADD CONSTRAINT iam_grants_subject_type_check CHECK (subject_type = 'group');
-- Data access can be given on one source or one table of a workspace; the
-- scope id is then '<namespace id>/<source or asset id>' (docs/prd/DQ §4).
ALTER TABLE public.iam_grants DROP CONSTRAINT IF EXISTS iam_grants_scope_type_check;
ALTER TABLE public.iam_grants
  ADD CONSTRAINT iam_grants_scope_type_check
  CHECK (scope_type IN ('tenant', 'group', 'workspace', 'source', 'asset'));

-- Names for user:<sub> actor references, refreshed when a person signs in,
-- so the UI can show who changed something, also after they have left.
CREATE TABLE IF NOT EXISTS public.iam_principals (
  sub          text PRIMARY KEY,
  display_name text,
  email        text,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- Tenant-level audit trail: changes outside any workspace (grants, workspaces
-- created or deleted). Workspace changes are in each workspace's audit_events.
CREATE TABLE IF NOT EXISTS public.iam_audit_events (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.iam_tenants (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor       text,
  action      text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS iam_audit_events_tenant_idx
  ON public.iam_audit_events (tenant_id, occurred_at DESC);

-- People and groups are managed in the identity server; Classifyre no longer
-- makes accounts, so it keeps no list of them.
DROP TABLE IF EXISTS public.iam_people;

-- Workspace categories belong to a tenant. NULL is only the built-in default
-- category, shared by every tenant.
ALTER TABLE public.namespace_categories
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.iam_tenants (id) ON DELETE CASCADE;
DROP INDEX IF EXISTS public.namespace_categories_title_key;
CREATE UNIQUE INDEX IF NOT EXISTS namespace_categories_tenant_title_key
  ON public.namespace_categories
     (COALESCE(tenant_id, '${LOCAL_TENANT_ID}'::uuid), lower(title));

-- Sign-in is always on: the 'local' tenant of workspaces made without it stays
-- only where something still belongs to it (the open database).
DELETE FROM public.iam_tenants t
 WHERE t.id = '${LOCAL_TENANT_ID}'
   AND NOT EXISTS (SELECT 1 FROM public.namespaces n WHERE n.tenant_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM public.namespace_categories c WHERE c.tenant_id = t.id);
`;

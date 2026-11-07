/**
 * Tenants and grants (docs/prd/IAM-access-management.md §5), next to the
 * namespace registry in `public`. Idempotent DDL, run at boot right after
 * {@link REGISTRY_TABLE_DDL} under the same migration lock.
 *
 * There is always at least one tenant: `local`, which owns every workspace
 * while sign-in is off. Code never branches on "is there a tenant".
 */
export const LOCAL_TENANT_ID = '00000000-0000-4000-8000-0000000000aa';

export const IAM_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS public.iam_tenants (
  id         uuid PRIMARY KEY,
  -- The organization's alias in the identity server; 'local' without sign-in.
  alias      text NOT NULL UNIQUE,
  name       text NOT NULL,
  -- The organization's id in the identity server; NULL for 'local'.
  org_id     text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.iam_tenants (id, alias, name)
VALUES ('${LOCAL_TENANT_ID}', 'local', 'Local')
ON CONFLICT (id) DO NOTHING;
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

-- A workspace belongs to exactly one tenant, and with sign-in on is owned by
-- exactly one of its groups (an organization group id in the identity server).
ALTER TABLE public.namespaces
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.iam_tenants (id);
UPDATE public.namespaces SET tenant_id = '${LOCAL_TENANT_ID}' WHERE tenant_id IS NULL;
ALTER TABLE public.namespaces
  ALTER COLUMN tenant_id SET DEFAULT '${LOCAL_TENANT_ID}',
  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.namespaces
  ADD COLUMN IF NOT EXISTS owner_group_id text;
CREATE INDEX IF NOT EXISTS namespaces_tenant_idx ON public.namespaces (tenant_id);

-- A grant gives a group (or one person) a role on a scope: the whole tenant,
-- every workspace a group owns, or one workspace. Grants only add up.
CREATE TABLE IF NOT EXISTS public.iam_grants (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.iam_tenants (id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('group', 'user')),
  -- Organization group id, or the person's subject id.
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

-- Accounts Classifyre created for a tenant (People → Add). Only these get
-- temporary passwords from Classifyre, and only these are deleted when they
-- leave their last tenant; accounts from a directory or an operator stay.
CREATE TABLE IF NOT EXISTS public.iam_people (
  sub        text NOT NULL,
  tenant_id  uuid NOT NULL REFERENCES public.iam_tenants (id) ON DELETE CASCADE,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sub, tenant_id)
);

-- Workspace categories belong to a tenant, 'local' without sign-in. NULL is
-- only the built-in default category, shared by every tenant.
ALTER TABLE public.namespace_categories
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.iam_tenants (id) ON DELETE CASCADE;
-- Categories made without sign-in used to be NULL too, and so would show in
-- every tenant (docs/prd/TEN §6).
UPDATE public.namespace_categories SET tenant_id = '${LOCAL_TENANT_ID}'
 WHERE tenant_id IS NULL AND id <> '00000000-0000-4000-8000-000000000001';
DROP INDEX IF EXISTS public.namespace_categories_title_key;
CREATE UNIQUE INDEX IF NOT EXISTS namespace_categories_tenant_title_key
  ON public.namespace_categories
     (COALESCE(tenant_id, '${LOCAL_TENANT_ID}'::uuid), lower(title));
`;

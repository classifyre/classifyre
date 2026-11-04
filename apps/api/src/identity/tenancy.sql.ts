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
`;

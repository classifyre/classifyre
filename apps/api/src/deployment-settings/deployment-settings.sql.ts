/**
 * Deployment-wide settings, one row per key.
 *
 * Lives in the control database's `public` schema like the namespace registry
 * and the worker queue state, because what it holds is not a property of one
 * workspace: how many scans the machine runs at once is shared by every
 * workspace on it. The DDL is idempotent and runs on every boot.
 */
export const DEPLOYMENT_SETTINGS_DDL = `
CREATE TABLE IF NOT EXISTS public.deployment_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

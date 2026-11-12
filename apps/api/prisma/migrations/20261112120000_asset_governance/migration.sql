-- Governed data assets, phase G-1 (docs/prd/GOV-governed-data-assets.md):
-- owners, stewards and custodians of sources and assets, and an asset's
-- description and lifecycle.

DO $$ BEGIN
  CREATE TYPE "GovernanceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED', 'RETIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LegalBasis" AS ENUM ('CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'VITAL_INTERESTS', 'PUBLIC_TASK', 'LEGITIMATE_INTERESTS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GovernanceScope" AS ENUM ('SOURCE', 'ASSET');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GovernanceRoleKind" AS ENUM ('OWNER', 'STEWARD', 'CUSTODIAN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "asset_governance" (
  "asset_id" TEXT NOT NULL,
  "status" "GovernanceStatus" NOT NULL DEFAULT 'DRAFT',
  "description" TEXT,
  "usage" TEXT,
  "limitations" TEXT,
  "legal_basis" "LegalBasis",
  "retention" TEXT,
  "certified_at" TIMESTAMP(3),
  "certified_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" TEXT,
  CONSTRAINT "asset_governance_pkey" PRIMARY KEY ("asset_id"),
  CONSTRAINT "asset_governance_asset_id_fkey" FOREIGN KEY ("asset_id")
    REFERENCES "assets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "asset_governance_status_idx" ON "asset_governance" ("status");

CREATE TABLE IF NOT EXISTS "governance_roles" (
  "id" TEXT NOT NULL,
  "scope_type" "GovernanceScope" NOT NULL,
  "scope_id" TEXT NOT NULL,
  "role" "GovernanceRoleKind" NOT NULL,
  "principal_ref" TEXT NOT NULL,
  "date_in" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_out" TIMESTAMP(3),
  "replaced_by_ref" TEXT,
  "assigned_by" TEXT,
  "removed_by" TEXT,
  CONSTRAINT "governance_roles_pkey" PRIMARY KEY ("id"),
  -- R1: the owner is one person, a custodian is a team.
  CONSTRAINT "governance_roles_principal_check" CHECK (
    ("role" = 'OWNER' AND "principal_ref" LIKE 'user:%')
    OR ("role" = 'CUSTODIAN' AND "principal_ref" LIKE 'group:%')
    OR ("role" = 'STEWARD' AND ("principal_ref" LIKE 'user:%' OR "principal_ref" LIKE 'group:%'))
  )
);
CREATE INDEX IF NOT EXISTS "governance_roles_scope_type_scope_id_idx" ON "governance_roles" ("scope_type", "scope_id");
CREATE INDEX IF NOT EXISTS "governance_roles_principal_ref_idx" ON "governance_roles" ("principal_ref");
-- One open owner per source or asset; the same principal once per open role.
CREATE UNIQUE INDEX IF NOT EXISTS "governance_roles_one_owner_key"
  ON "governance_roles" ("scope_type", "scope_id")
  WHERE "role" = 'OWNER' AND "date_out" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "governance_roles_open_principal_key"
  ON "governance_roles" ("scope_type", "scope_id", "role", "principal_ref")
  WHERE "date_out" IS NULL;

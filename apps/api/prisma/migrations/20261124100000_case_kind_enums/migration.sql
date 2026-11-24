-- Data requests (docs/prd/DR-data-requests.md): enum types and CaseActivityType values.
-- Lives in its own migration because PostgreSQL cannot use newly added enum values
-- in the same transaction that adds them.

DO $$ BEGIN
  CREATE TYPE "CaseKind" AS ENUM ('INVESTIGATION', 'DATA_REQUEST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DataRequestState" AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'IN_PROGRESS',
    'CHANGES_REQUESTED',
    'DELIVERED',
    'DECLINED',
    'WITHDRAWN'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DataRequestDeliveryMode" AS ENUM (
    'PUBLISHED',
    'LINKED',
    'UPDATED',
    'SELF_SERVE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'REQUEST_SUBMITTED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'REQUEST_CLAIMED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'REQUEST_REROUTED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'REQUEST_SQL_EDITED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'REQUEST_DELIVERED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'REQUEST_CHANGES_REQUESTED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'REQUEST_DECLINED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'REQUEST_WITHDRAWN';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'REQUEST_REOPENED';

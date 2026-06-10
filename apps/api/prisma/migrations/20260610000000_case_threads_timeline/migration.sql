-- Case threads, thread entries, thread support, and unified activity timeline.
-- Migrates existing case_hypotheses → case_threads (HYPOTHESIS kind), preserving UUIDs.

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "CaseThreadKind" AS ENUM ('HYPOTHESIS', 'DISCUSSION');
CREATE TYPE "CaseThreadEntryType" AS ENUM ('NOTE', 'STATEMENT', 'STATUS_CHANGE', 'CONFIDENCE_CHANGE');
CREATE TYPE "CaseActivityType" AS ENUM (
  'CASE_CREATED', 'CASE_UPDATED', 'CONCLUSION_UPDATED',
  'INQUIRY_LINKED', 'INQUIRY_UNLINKED', 'INQUIRY_PULLED',
  'EVIDENCE_ADDED', 'EVIDENCE_REMOVED', 'EVIDENCE_NOTE_UPDATED',
  'FINDING_ADDED', 'FINDING_REMOVED', 'FINDING_NOTE_UPDATED',
  'THREAD_CREATED', 'THREAD_ENTRY_ADDED', 'THREAD_STATEMENT_UPDATED',
  'THREAD_STATUS_CHANGED', 'THREAD_CONFIDENCE_CHANGED',
  'SUPPORT_LINKED', 'SUPPORT_UNLINKED', 'SUPPORT_UPDATED'
);

-- ─── case_threads ─────────────────────────────────────────────────────────────

CREATE TABLE "case_threads" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "case_id"    TEXT        NOT NULL,
  "kind"       "CaseThreadKind" NOT NULL DEFAULT 'HYPOTHESIS',
  "title"      TEXT        NOT NULL,
  "status"     "HypothesisStatus",
  "confidence" DECIMAL(3,2),
  "color"      TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "case_threads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_threads_case_id_fkey"
    FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE
);

CREATE INDEX "case_threads_case_id_idx"      ON "case_threads"("case_id");
CREATE INDEX "case_threads_case_id_kind_idx" ON "case_threads"("case_id", "kind");

-- ─── Migrate existing hypotheses → threads (preserve UUIDs) ──────────────────

INSERT INTO "case_threads"
  ("id", "case_id", "kind", "title", "status", "confidence", "color", "created_by", "created_at", "updated_at")
SELECT
  h.id,
  h.case_id,
  'HYPOTHESIS'::"CaseThreadKind",
  LEFT(h.statement, 200),          -- title = first 200 chars of statement
  h.status,
  h.confidence,
  h.color,
  h.created_by,
  h.created_at,
  h.updated_at
FROM case_hypotheses h;

-- ─── case_thread_entries ──────────────────────────────────────────────────────

CREATE TABLE "case_thread_entries" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "thread_id"  TEXT        NOT NULL,
  "entry_type" "CaseThreadEntryType" NOT NULL DEFAULT 'NOTE',
  "body"       TEXT,
  "metadata"   JSONB,
  "author"     TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "case_thread_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_thread_entries_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "case_threads"("id") ON DELETE CASCADE
);

CREATE INDEX "case_thread_entries_thread_id_created_at_idx"
  ON "case_thread_entries"("thread_id", "created_at");

-- Seed initial STATEMENT entry for each migrated hypothesis
INSERT INTO "case_thread_entries"
  ("id", "thread_id", "entry_type", "body", "author", "created_at")
SELECT
  gen_random_uuid()::text,
  h.id,
  'STATEMENT'::"CaseThreadEntryType",
  h.statement,
  h.created_by,
  h.created_at
FROM case_hypotheses h;

-- ─── case_thread_support ─────────────────────────────────────────────────────

CREATE TABLE "case_thread_support" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "thread_id"   TEXT        NOT NULL,
  "entry_id"    TEXT,
  "target_type" TEXT        NOT NULL,
  "target_id"   TEXT        NOT NULL,
  "stance"      "EvidenceStance" NOT NULL DEFAULT 'SUPPORTS',
  "weight"      DECIMAL(3,2),
  "note"        TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "case_thread_support_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_thread_support_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "case_threads"("id") ON DELETE CASCADE,
  CONSTRAINT "case_thread_support_entry_id_fkey"
    FOREIGN KEY ("entry_id") REFERENCES "case_thread_entries"("id") ON DELETE SET NULL,
  CONSTRAINT "case_thread_support_thread_id_target_type_target_id_key"
    UNIQUE ("thread_id", "target_type", "target_id")
);

CREATE INDEX "case_thread_support_thread_id_idx"       ON "case_thread_support"("thread_id");
CREATE INDEX "case_thread_support_target_type_id_idx"  ON "case_thread_support"("target_type", "target_id");

-- Migrate hypothesis_support → case_thread_support (thread_id = hypothesis_id)
INSERT INTO "case_thread_support"
  ("id", "thread_id", "target_type", "target_id", "stance", "weight", "note", "created_at")
SELECT
  s.id,
  s.hypothesis_id,
  s.target_type,
  s.target_id,
  s.stance,
  s.weight,
  s.note,
  s.created_at
FROM hypothesis_support s;

-- ─── case_activities ──────────────────────────────────────────────────────────

CREATE TABLE "case_activities" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "case_id"       TEXT        NOT NULL,
  "activity_type" "CaseActivityType" NOT NULL,
  "actor"         TEXT,
  "payload"       JSONB,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "case_activities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_activities_case_id_fkey"
    FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE
);

CREATE INDEX "case_activities_case_id_created_at_idx"
  ON "case_activities"("case_id", "created_at" DESC);

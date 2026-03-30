-- CreateEnum
CREATE TYPE "TestResultStatus" AS ENUM ('PASS', 'FAIL', 'ERROR');

-- CreateEnum
CREATE TYPE "TestTrigger" AS ENUM ('MANUAL', 'CI', 'ASSISTANT');

-- CreateTable
CREATE TABLE "custom_detector_test_scenarios" (
    "id" TEXT NOT NULL,
    "detector_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "input_text" TEXT NOT NULL,
    "expected_outcome" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_detector_test_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_detector_test_results" (
    "id" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "detector_id" TEXT NOT NULL,
    "status" "TestResultStatus" NOT NULL,
    "actual_output" JSONB NOT NULL,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "detector_version" INTEGER NOT NULL,
    "triggered_by" "TestTrigger" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_detector_test_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_detector_test_scenarios_detector_id_idx" ON "custom_detector_test_scenarios"("detector_id");

-- CreateIndex
CREATE INDEX "custom_detector_test_results_scenario_id_created_at_idx" ON "custom_detector_test_results"("scenario_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "custom_detector_test_results_detector_id_created_at_idx" ON "custom_detector_test_results"("detector_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "custom_detector_test_scenarios" ADD CONSTRAINT "custom_detector_test_scenarios_detector_id_fkey" FOREIGN KEY ("detector_id") REFERENCES "custom_detectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_detector_test_results" ADD CONSTRAINT "custom_detector_test_results_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "custom_detector_test_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

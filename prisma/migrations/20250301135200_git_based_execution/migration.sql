-- AlterTable: Migrate from artifact-based to Git-based execution
-- Add new columns
ALTER TABLE "jobs"."jobs" ADD COLUMN IF NOT EXISTS "repoUrl" TEXT;
ALTER TABLE "jobs"."jobs" ADD COLUMN IF NOT EXISTS "branch" TEXT DEFAULT 'main';
ALTER TABLE "jobs"."jobs" ADD COLUMN IF NOT EXISTS "startCommand" TEXT;

-- Backfill existing rows (required for NOT NULL)
UPDATE "jobs"."jobs"
SET
  "repoUrl" = COALESCE("repoUrl", 'https://github.com/legacy/migrated'),
  "branch" = COALESCE("branch", 'main'),
  "startCommand" = COALESCE("startCommand", 'legacy')
WHERE "repoUrl" IS NULL OR "startCommand" IS NULL;

-- Enforce NOT NULL
ALTER TABLE "jobs"."jobs" ALTER COLUMN "repoUrl" SET NOT NULL;
ALTER TABLE "jobs"."jobs" ALTER COLUMN "branch" SET NOT NULL;
ALTER TABLE "jobs"."jobs" ALTER COLUMN "startCommand" SET NOT NULL;

-- Drop old columns
ALTER TABLE "jobs"."jobs" DROP COLUMN IF EXISTS "entrypoint";
ALTER TABLE "jobs"."jobs" DROP COLUMN IF EXISTS "inputArtifacts";

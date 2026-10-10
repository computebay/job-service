-- Add workerInfo for anonymized worker specs at pickup
ALTER TABLE "jobs"."jobs" ADD COLUMN "workerInfo" JSONB;

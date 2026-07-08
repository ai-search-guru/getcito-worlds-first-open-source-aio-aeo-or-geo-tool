-- Add progress tracking column to reports table
ALTER TABLE "reports" ADD COLUMN "progress" integer NOT NULL DEFAULT 0;

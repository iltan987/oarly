DROP INDEX "audit_log_created_at_id_idx";--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
CREATE INDEX "audit_log_club_created_at_id_idx" ON "audit_log" USING btree ("club_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_log_created_at_id_idx" ON "audit_log" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);
ALTER TABLE "audit_events" ADD COLUMN "seq" bigint;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_workspace_seq_uq" ON "audit_events" USING btree ("workspace_id","seq");
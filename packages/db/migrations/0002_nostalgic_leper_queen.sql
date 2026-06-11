ALTER TABLE "agent_handoffs" ADD COLUMN "deadline_minutes" smallint DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_handoffs" ADD COLUMN "requeue_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_handoffs_reaper_idx" ON "agent_handoffs" USING btree ("state","deadline_at");
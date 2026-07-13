ALTER TABLE "task_comments" ADD COLUMN "author_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "decision_comments" ADD COLUMN "author_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_comments" ADD CONSTRAINT "decision_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
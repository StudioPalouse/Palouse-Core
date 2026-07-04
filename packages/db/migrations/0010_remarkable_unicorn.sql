CREATE TYPE "public"."task_origin" AS ENUM('user', 'agent');--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "origin" "task_origin" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "created_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
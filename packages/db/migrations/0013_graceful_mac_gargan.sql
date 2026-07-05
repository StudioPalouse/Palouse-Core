CREATE TYPE "public"."decision_entity_type" AS ENUM('task', 'project', 'goal', 'context');--> statement-breakpoint
CREATE TYPE "public"."decision_origin" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."decision_resource_kind" AS ENUM('link', 'document', 'other');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('proposed', 'under_review', 'accepted', 'rejected', 'deprecated', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."raci_role" AS ENUM('responsible', 'accountable', 'consulted', 'informed');--> statement-breakpoint
CREATE TABLE "decision_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body_md" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"entity_type" "decision_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"kind" "decision_resource_kind" DEFAULT 'link' NOT NULL,
	"added_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_stakeholders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "raci_role" NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description_md" text,
	"area" text,
	"status" "decision_status" DEFAULT 'proposed' NOT NULL,
	"decided_at" timestamp with time zone,
	"superseded_by_decision_id" uuid,
	"origin" "decision_origin" DEFAULT 'user' NOT NULL,
	"created_by_user_id" uuid,
	"created_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_comments" ADD CONSTRAINT "decision_comments_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_comments" ADD CONSTRAINT "decision_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_relations" ADD CONSTRAINT "decision_relations_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_relations" ADD CONSTRAINT "decision_relations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_resources" ADD CONSTRAINT "decision_resources_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_resources" ADD CONSTRAINT "decision_resources_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_stakeholders" ADD CONSTRAINT "decision_stakeholders_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_stakeholders" ADD CONSTRAINT "decision_stakeholders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_stakeholders" ADD CONSTRAINT "decision_stakeholders_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_superseded_by_decision_id_decisions_id_fk" FOREIGN KEY ("superseded_by_decision_id") REFERENCES "public"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_comments_decision_created_idx" ON "decision_comments" USING btree ("decision_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_relations_decision_entity_uq" ON "decision_relations" USING btree ("decision_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "decision_relations_decision_idx" ON "decision_relations" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "decision_resources_decision_idx" ON "decision_resources" USING btree ("decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_stakeholders_decision_user_role_uq" ON "decision_stakeholders" USING btree ("decision_id","user_id","role");--> statement-breakpoint
CREATE INDEX "decision_stakeholders_decision_idx" ON "decision_stakeholders" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "decisions_workspace_idx" ON "decisions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "decisions_workspace_status_idx" ON "decisions" USING btree ("workspace_id","status");
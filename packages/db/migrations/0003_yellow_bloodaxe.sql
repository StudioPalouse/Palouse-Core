CREATE TYPE "public"."price_source" AS ENUM('catalog', 'workspace_override', 'self_reported', 'unpriced');--> statement-breakpoint
CREATE TYPE "public"."usage_source" AS ENUM('mcp', 'otlp');--> statement-breakpoint
CREATE TABLE "handoff_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handoff_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"title" text NOT NULL,
	"detail_md" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"source" "usage_source" DEFAULT 'mcp' NOT NULL,
	"otel_span_id" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handoff_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"step_id" uuid,
	"source" "usage_source" NOT NULL,
	"model" text NOT NULL,
	"provider" text,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 8),
	"self_reported_cost_usd" numeric(14, 8),
	"price_source" "price_source" DEFAULT 'unpriced' NOT NULL,
	"model_price_id" uuid,
	"price_snapshot" jsonb,
	"otel_trace_id" text,
	"otel_span_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"match_pattern" text,
	"input_per_m_usd" numeric(12, 6) NOT NULL,
	"output_per_m_usd" numeric(12, 6) NOT NULL,
	"cache_read_per_m_usd" numeric(12, 6),
	"cache_write_per_m_usd" numeric(12, 6),
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"catalog_version" text NOT NULL,
	"source" text DEFAULT 'builtin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_rollups_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"model" text NOT NULL,
	"day" date NOT NULL,
	"generation_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd" numeric(16, 8) DEFAULT '0' NOT NULL,
	"unpriced_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_model_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text,
	"model" text NOT NULL,
	"input_per_m_usd" numeric(12, 6) NOT NULL,
	"output_per_m_usd" numeric(12, 6) NOT NULL,
	"cache_read_per_m_usd" numeric(12, 6),
	"cache_write_per_m_usd" numeric(12, 6),
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handoff_steps" ADD CONSTRAINT "handoff_steps_handoff_id_agent_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."agent_handoffs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_steps" ADD CONSTRAINT "handoff_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_generations" ADD CONSTRAINT "llm_generations_handoff_id_agent_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."agent_handoffs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_generations" ADD CONSTRAINT "llm_generations_step_id_handoff_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."handoff_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_generations" ADD CONSTRAINT "llm_generations_model_price_id_model_prices_id_fk" FOREIGN KEY ("model_price_id") REFERENCES "public"."model_prices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_model_prices" ADD CONSTRAINT "workspace_model_prices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_model_prices" ADD CONSTRAINT "workspace_model_prices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_steps_handoff_seq_uq" ON "handoff_steps" USING btree ("handoff_id","seq");--> statement-breakpoint
CREATE INDEX "handoff_steps_workspace_idx" ON "handoff_steps" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "llm_generations_handoff_idx" ON "llm_generations" USING btree ("handoff_id");--> statement-breakpoint
CREATE INDEX "llm_generations_workspace_day_idx" ON "llm_generations" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_generations_otel_span_uq" ON "llm_generations" USING btree ("handoff_id","otel_span_id") WHERE otel_span_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "model_prices_model_effective_uq" ON "model_prices" USING btree ("provider","model","effective_from");--> statement-breakpoint
CREATE INDEX "model_prices_model_idx" ON "model_prices" USING btree ("model");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_rollups_daily_uq" ON "usage_rollups_daily" USING btree ("workspace_id","agent_id","model","day");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_model_prices_effective_uq" ON "workspace_model_prices" USING btree ("workspace_id","model","effective_from");
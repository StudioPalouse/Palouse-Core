ALTER TYPE "public"."external_system" ADD VALUE 'notion' BEFORE 'reqops';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'notion';--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "config" jsonb;
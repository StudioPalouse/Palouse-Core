ALTER TABLE "integrations" ADD COLUMN "webhook_nonce_hash" text;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "webhook_nonce_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "webhook_client_state_hash" text;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "webhook_status" text DEFAULT 'none' NOT NULL;
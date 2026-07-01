CREATE TYPE "public"."membership_status" AS ENUM('active', 'inactive');--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "status" "membership_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "deactivated_at" timestamp with time zone;
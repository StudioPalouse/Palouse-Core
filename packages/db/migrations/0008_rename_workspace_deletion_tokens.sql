ALTER TABLE "account_deletion_tokens" RENAME TO "workspace_deletion_tokens";
--> statement-breakpoint
ALTER TABLE "workspace_deletion_tokens" RENAME CONSTRAINT "account_deletion_tokens_workspace_id_workspaces_id_fk" TO "workspace_deletion_tokens_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_deletion_tokens" RENAME CONSTRAINT "account_deletion_tokens_requested_by_user_id_users_id_fk" TO "workspace_deletion_tokens_requested_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER INDEX "account_deletion_tokens_hash_idx" RENAME TO "workspace_deletion_tokens_hash_idx";
--> statement-breakpoint
ALTER INDEX "account_deletion_tokens_workspace_idx" RENAME TO "workspace_deletion_tokens_workspace_idx";

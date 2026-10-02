CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"project_id" uuid,
	"employee_id" uuid,
	"runtime" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"agent_profile" text,
	"kiro_session_id" text,
	"worker_id" integer,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"error_class" text,
	"error_message" text,
	"fallback_reason" text,
	"prompt" text NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"credits" double precision DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"cost_estimated" boolean DEFAULT true NOT NULL,
	"duration_ms" integer,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"gate" text NOT NULL,
	"title" text NOT NULL,
	"requested_by_id" uuid,
	"approver_role" text NOT NULL,
	"required_authority" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alternatives" text DEFAULT '' NOT NULL,
	"risks" text DEFAULT '' NOT NULL,
	"impact" text DEFAULT '' NOT NULL,
	"cost" text DEFAULT '' NOT NULL,
	"recommendation" text DEFAULT '' NOT NULL,
	"decided_by" text,
	"decided_by_name" text,
	"decided_by_authority" integer,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"format" text DEFAULT 'markdown' NOT NULL,
	"content" text NOT NULL,
	"data" jsonb,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"target" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ceo_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'DONE' NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"release_id" uuid,
	"suite" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mission" text DEFAULT '' NOT NULL,
	"policies" jsonb NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"proposed_by" text NOT NULL,
	"reviewed_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by" text,
	"status" text DEFAULT 'ACCEPTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"floor" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"url" text,
	"commit" text NOT NULL,
	"path" text,
	"port" integer,
	"log" text DEFAULT '' NOT NULL,
	"rollback_of_id" uuid,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"role_key" text NOT NULL,
	"department_key" text NOT NULL,
	"manager_id" uuid,
	"status" text DEFAULT 'IDLE' NOT NULL,
	"current_task_id" uuid,
	"current_activity" text,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"employee_id" uuid,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"project_id" uuid,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"postmortem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "incidents_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"positions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" text DEFAULT '' NOT NULL,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"project_id" uuid,
	"employee_id" uuid,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"from_employee_id" uuid,
	"to_employee_id" uuid,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitor_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"url" text NOT NULL,
	"ok" boolean NOT NULL,
	"http_status" integer,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"category" text NOT NULL,
	"severity" text DEFAULT 'INFO' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owners_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'FULL_STACK_APP' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"phase" text DEFAULT 'INTAKE' NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"budget" text,
	"deadline" timestamp with time zone,
	"risk" text DEFAULT 'LOW' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"ceo_sponsor_id" uuid,
	"project_manager_id" uuid,
	"departments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"workspace_path" text,
	"repository_url" text,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"deployment" jsonb NOT NULL,
	"production_url" text,
	"staging_url" text,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_request" text DEFAULT '' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"secret_id" uuid,
	"base_url" text,
	"model" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"health" text DEFAULT 'UNKNOWN' NOT NULL,
	"health_message" text,
	"last_checked_at" timestamp with time zone,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_input_per_mtok" double precision,
	"cost_output_per_mtok" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" text NOT NULL,
	"commit" text NOT NULL,
	"status" text DEFAULT 'CANDIDATE' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"gates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"level" text NOT NULL,
	"authority" integer NOT NULL,
	"department_key" text NOT NULL,
	"reports_to" text,
	"kiro_agent" text NOT NULL,
	"responsibilities" text DEFAULT '' NOT NULL,
	"capabilities" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"masked" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"project_id" uuid,
	"phase" text,
	"stage" text NOT NULL,
	"department_key" text NOT NULL,
	"role_key" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'BACKLOG' NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"assignee_id" uuid,
	"reviewer_id" uuid,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"blocked_reason" text,
	"runtime" text,
	"cost_credits" double precision DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"branch" text,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision" text DEFAULT 'AUTO' NOT NULL,
	"reason" text,
	"input" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_key_departments_key_fk" FOREIGN KEY ("department_key") REFERENCES "public"."departments"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_sessions" ADD CONSTRAINT "owner_sessions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_department_key_departments_key_fk" FOREIGN KEY ("department_key") REFERENCES "public"."departments"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_task_idx" ON "agent_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runs_created_idx" ON "agent_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "approvals_project_idx" ON "approvals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "artifacts_project_idx" ON "artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_version_uq" ON "artifacts" USING btree ("project_id","kind","title","version");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "checks_project_idx" ON "check_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "employees_role_idx" ON "employees" USING btree ("role_key");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "events_project_idx" ON "events" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "memories_project_idx" ON "memories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "messages_project_idx" ON "messages" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "monitor_project_idx" ON "monitor_samples" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tool_calls_run_idx" ON "tool_calls" USING btree ("run_id");
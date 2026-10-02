CREATE TABLE "addendum" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"summary" text NOT NULL,
	"question_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"new_closes_at" timestamp with time zone,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"trigger_date" date NOT NULL,
	"recipient_rule" text DEFAULT 'CONTRACT_OWNER' NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"origin" text DEFAULT 'SYSTEM' NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"org_unit_id" uuid,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"supplier_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"stamp" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"correlation_id" text,
	"result" text DEFAULT 'SUCCESS' NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"proposed_changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clause" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"clause_id" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"mandatory" boolean DEFAULT false NOT NULL,
	"changed_from_template" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coi_declaration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"none" boolean NOT NULL,
	"nature" text,
	"subject_org" text,
	"disposition" text DEFAULT 'PENDING' NOT NULL,
	"routed_to" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consensus_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"variance_pct" numeric(6, 2),
	"flagged" boolean DEFAULT false NOT NULL,
	"consensus_score" numeric(4, 2),
	"rationale" text
);
--> statement-breakpoint
CREATE TABLE "contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"tender_id" uuid,
	"supplier_id" uuid NOT NULL,
	"parent_id" uuid,
	"template_id" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"start_date" date,
	"end_date" date,
	"notice_days" integer DEFAULT 90 NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"context_id" uuid,
	"simulated" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criterion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"weight" numeric(5, 2) NOT NULL,
	"stream" text NOT NULL,
	"pass_fail" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"role" text NOT NULL,
	"user_id" uuid,
	"max_value" numeric(14, 2) NOT NULL,
	"division" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_report_evaluation_id_unique" UNIQUE("evaluation_id")
);
--> statement-breakpoint
CREATE TABLE "evaluation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"status" text DEFAULT 'COI_PENDING' NOT NULL,
	"variance_limit_pct" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "evaluation_tender_id_unique" UNIQUE("tender_id")
);
--> statement-breakpoint
CREATE TABLE "field_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"value" text,
	"source" text DEFAULT 'USER' NOT NULL,
	"ai_drafted" boolean DEFAULT false NOT NULL,
	"missing" boolean DEFAULT false NOT NULL,
	"previous_value" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"scan" text DEFAULT 'PENDING' NOT NULL,
	"section" text DEFAULT 'OTHER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"email" text NOT NULL,
	"company" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panel_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"stream" text NOT NULL,
	"coi_state" text DEFAULT 'NOT_DECLARED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"summary" text,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "plan_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"text" text NOT NULL,
	"answer" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"asked_by_supplier_id" uuid,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"unspsc" text,
	"estimated_value" numeric(14, 2),
	"currency" text DEFAULT 'AUD' NOT NULL,
	"term_months" integer,
	"business_unit" text,
	"requester_id" uuid NOT NULL,
	"phase" text DEFAULT 'INTAKE' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"intake_mode" text DEFAULT 'TEAM_LED' NOT NULL,
	"complexity" text,
	"budget_check" text DEFAULT 'NOT_RUN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"division" text
);
--> statement-breakpoint
CREATE TABLE "score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"evaluator_id" uuid NOT NULL,
	"score" numeric(4, 2) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"receipt" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company" text NOT NULL,
	"abn" text NOT NULL,
	"sanctions_status" text DEFAULT 'PENDING' NOT NULL,
	"insurance_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"region" text DEFAULT 'ap-southeast-2' NOT NULL,
	"sector" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tender" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"type" text NOT NULL,
	"access" text DEFAULT 'CLOSED' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"publish_permission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tier" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"editable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_uq" ON "app_user" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_event" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_tenant_seq_idx" ON "audit_event" USING btree ("tenant_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "consensus_uq" ON "consensus_item" USING btree ("evaluation_id","supplier_id","criterion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_value_uq" ON "field_value" USING btree ("owner_type","owner_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_uq" ON "idempotency_key" USING btree ("tenant_id","user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "panel_member_uq" ON "panel_member" USING btree ("evaluation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_number_uq" ON "request" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "request_requester_idx" ON "request" USING btree ("requester_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignment_uq" ON "role_assignment" USING btree ("user_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "score_uq" ON "score" USING btree ("evaluation_id","supplier_id","criterion_id","evaluator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_uq" ON "submission" USING btree ("tender_id","supplier_id");
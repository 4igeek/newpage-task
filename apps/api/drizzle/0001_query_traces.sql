CREATE TABLE "query_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"question" text NOT NULL,
	"query" text NOT NULL,
	"rewritten" boolean NOT NULL,
	"document_ids" uuid[],
	"outcome" text NOT NULL,
	"error_code" text,
	"model" text NOT NULL,
	"answer" text NOT NULL,
	"sources" jsonb NOT NULL,
	"top_similarity" real,
	"citations" integer[] NOT NULL,
	"invalid_citations" integer[] NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"rewrite_ms" integer NOT NULL,
	"retrieval_ms" integer,
	"first_token_ms" integer,
	"total_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "query_traces_created_at_idx" ON "query_traces" USING btree ("created_at");
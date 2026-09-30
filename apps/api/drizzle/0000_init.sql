CREATE TABLE "advice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"action" text NOT NULL,
	"confidence" double precision NOT NULL,
	"rationale" text NOT NULL,
	"stop_loss" double precision,
	"take_profit" double precision,
	"analysis_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"base_url" text NOT NULL,
	"api_key_enc" text,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_roles" (
	"role" text PRIMARY KEY NOT NULL,
	"provider_id" text,
	"model" text,
	"input_price_per_mtok" double precision,
	"output_price_per_mtok" double precision
);
--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"opportunity_id" uuid,
	"position_id" uuid,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"score" double precision,
	"previous_score" double precision,
	"summary" text NOT NULL,
	"output" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"cik" text NOT NULL,
	"form" text NOT NULL,
	"accession" text NOT NULL,
	"filed_at" timestamp with time zone NOT NULL,
	"url" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"target" text,
	"priority" double precision DEFAULT 0 NOT NULL,
	"priority_override" text,
	"progress" double precision DEFAULT 0 NOT NULL,
	"message" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider" text,
	"model" text,
	"cost_usd" double precision,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"channel" text NOT NULL,
	"author" text,
	"posted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"ticker" text NOT NULL,
	"publisher" text,
	"title" text NOT NULL,
	"summary" text,
	"url" text,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"stage" text DEFAULT 'EMERGING' NOT NULL,
	"score" double precision,
	"breakdown" jsonb,
	"thesis" jsonb,
	"themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"saturation" double precision DEFAULT 0 NOT NULL,
	"mentions_24h" integer DEFAULT 0 NOT NULL,
	"mentions_7d" integer DEFAULT 0 NOT NULL,
	"mention_growth_7d" double precision,
	"unique_authors_7d" integer DEFAULT 0 NOT NULL,
	"sentiment" double precision,
	"price" double precision,
	"change_1d" double precision,
	"auto_priority" double precision DEFAULT 0 NOT NULL,
	"priority_override" text,
	"watch" boolean DEFAULT false NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"first_flagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"flag_price" double precision,
	"last_researched_at" timestamp with time zone,
	"next_research_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"horizon_days" integer NOT NULL,
	"flagged_at" timestamp with time zone NOT NULL,
	"flag_price" double precision NOT NULL,
	"score_at_flag" double precision,
	"stage_at_flag" text,
	"breakdown_at_flag" jsonb,
	"price_after" double precision NOT NULL,
	"return_pct" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"quantity" double precision NOT NULL,
	"entry_price" double precision NOT NULL,
	"entry_date" date NOT NULL,
	"notes" text,
	"closed_at" timestamp with time zone,
	"exit_price" double precision,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"channel" text NOT NULL,
	"author" text,
	"title" text,
	"body" text,
	"url" text,
	"score" integer DEFAULT 0 NOT NULL,
	"num_comments" integer DEFAULT 0 NOT NULL,
	"is_comment" boolean DEFAULT false NOT NULL,
	"parent_external_id" text,
	"posted_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tickers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sentiment" double precision,
	"quality" text,
	"classified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"interval_min" integer NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_enc" text,
	"last_run_at" timestamp with time zone,
	"last_run_ok" boolean,
	"last_run_message" text,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticker_daily" (
	"ticker" text NOT NULL,
	"day" date NOT NULL,
	"mentions" integer DEFAULT 0 NOT NULL,
	"unique_authors" integer DEFAULT 0 NOT NULL,
	"avg_sentiment" double precision,
	"close" double precision,
	"volume" double precision,
	CONSTRAINT "ticker_daily_ticker_day_pk" PRIMARY KEY("ticker","day")
);
--> statement-breakpoint
CREATE TABLE "tickers" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text,
	"cik" text,
	"exchange" text,
	"sector" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advice" ADD CONSTRAINT "advice_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advice_position_idx" ON "advice" USING btree ("position_id","created_at");--> statement-breakpoint
CREATE INDEX "analyses_ticker_idx" ON "analyses" USING btree ("ticker","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "filings_accession_uq" ON "filings" USING btree ("accession");--> statement-breakpoint
CREATE INDEX "filings_ticker_idx" ON "filings" USING btree ("ticker","filed_at");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX "jobs_created_idx" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_usage_created_idx" ON "llm_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mentions_ticker_time_idx" ON "mentions" USING btree ("ticker","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mentions_post_ticker_uq" ON "mentions" USING btree ("post_id","ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "news_source_ext_uq" ON "news_items" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "news_ticker_idx" ON "news_items" USING btree ("ticker","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_ticker_uq" ON "opportunities" USING btree ("ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "outcomes_opp_horizon_uq" ON "outcomes" USING btree ("opportunity_id","horizon_days");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_source_ext_uq" ON "posts" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "posts_posted_at_idx" ON "posts" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "posts_unclassified_idx" ON "posts" USING btree ("classified_at");
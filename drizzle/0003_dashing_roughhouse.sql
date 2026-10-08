CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(100),
	"ref_file_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_ref_file_id_documents_id_fk" FOREIGN KEY ("ref_file_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;
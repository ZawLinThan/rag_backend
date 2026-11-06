CREATE TABLE "test_contents" (
	"test_id" uuid PRIMARY KEY NOT NULL,
	"instructions" text NOT NULL,
	"questions" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "has_math_formula" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "test_contents" ADD CONSTRAINT "test_contents_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
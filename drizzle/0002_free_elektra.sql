CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50),
	"semester" varchar(50),
	"color" varchar(7),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "flashcard_sets" ADD COLUMN "course_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_courses_user_id" ON "courses" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcard_sets" ADD CONSTRAINT "flashcard_sets_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "tags";--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_chunk_index_document_id_unique" UNIQUE("chunk_index","document_id");--> statement-breakpoint
ALTER TABLE "message_sources" ADD CONSTRAINT "message_sources_message_id_chunk_id_unique" UNIQUE("message_id","chunk_id");
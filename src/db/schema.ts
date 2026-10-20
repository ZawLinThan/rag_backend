import {
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
  varchar,
  vector,
  unique,
} from "drizzle-orm/pg-core";
export const profiles = pgTable("profiles", {
  id: uuid("user_id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // fk: id -> auth.users(id), handled by supabase
});

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(), // "DSA"
    code: varchar("code", { length: 50 }), // "CS 1332"
    semester: varchar("semester", { length: 50 }), // "Fall 2026"
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdIdx: index("idx_courses_user_id").on(t.userId),
  }),
);

export const notebooks = pgTable("notebooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  noteBookName: varchar("name", { length: 255 }).notNull(),
  courseId: uuid("courseId").references(() => courses.id, {
    onDelete: "cascade",
  }),
  // fk: userId -> auth.users(id)
  // fk: courseId -> courses(id)
});

export type DocumentStatus =
  "pending" | "queued" | "processing" | "ready" | "failed";
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    r2Key: varchar("r2_key", { length: 500 }).notNull(),
    fileType: varchar("file_type", { length: 250 }).notNull(), // pdf | docx | txt
    fileSize: integer("file_size").notNull(),
    status: text("status").$type<DocumentStatus>().default("pending").notNull(),
    errorMessage: text("error_message"),
    courseId: uuid("course_id").references(() => courses.id, {
      onDelete: "set null",
    }), // think about cascade
    notebookId: uuid("notebook_id").references(() => notebooks.id, {
      onDelete: "set null",
    }), // think about cascade
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    // fk: userId -> auth.users(id), handled by supabase
    // fk: courseId -> courses(id)
  },
  (t) => ({
    userIdIdx: index("idx_documents_user_id").on(t.userId),
    statusIdx: index("idx_documents_status").on(t.status),
  }),
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    content: text("content").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    pageNumber: integer("page_number"),
    tokenCount: integer("token_count"),
    embedding: vector("embedding", { dimensions: 1536 } as any),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // fk: userId -> auth.users(id), handled by supabase
  },
  (t) => ({
    documentIdIdx: index("idx_chunks_document_id").on(t.documentId),
    userIdIdx: index("idx_chunks_user_id").on(t.userId),
    uniqueChunk: unique().on(t.chunkIndex, t.documentId),
    // Optimize later via ivvflat or hnsw
  }),
);

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    title: varchar("title", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    // fk: userId -> auth.users(id), handled by supabase
  },
  (t) => ({
    userIdIdx: index("idx_chat_sessions_user_id").on(t.userId),
  }),
);

// M:N relationship: chat session <-> documents
export const chatSessionDocuments = pgTable(
  "chat_session_documents",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }), // should it be restrict or cascade
    // fk: sessionId -> chatSessions(id)
    // fk: documentId -> documents(id)
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.documentId] }),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(), // 'user' | 'assistant'
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // fk: sessionId -> chatSessions(id)
  },
  (t) => ({
    sessionIdIdx: index("idx_messages_session_id").on(t.sessionId),
  }),
);

// source chunks cited in an assistant message
export const messageSources = pgTable(
  "message_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    score: real("score"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueMessageChunk: unique().on(t.messageId, t.chunkId),
  }),
);

export const flashcardSets = pgTable(
  "flashcard_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 255 }).notNull(),
    courseId: uuid("course_id").references(() => courses.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    // fk: userId -> auth.users(id)
    // fk: documentId -> documents(id)
    // fk: courseId -> courses(id)
  },
  (t) => ({
    userIdIdx: index("idx_flashcard_sets_user_id").on(t.userId),
  }),
);

export const flashcards = pgTable(
  "flashcards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .notNull()
      .references(() => flashcardSets.id, { onDelete: "cascade" }),
    front: text("front").notNull(),
    back: text("back").notNull(),
    sourceChunkId: uuid("source_chunk_id").references(() => chunks.id, {
      onDelete: "set null",
    }),
    // SM-2 spaced repetition fields
    easeFactor: real("ease_factor").default(2.5).notNull(),
    interval: integer("interval").default(0).notNull(),
    repetitions: integer("repetitions").default(0).notNull(),
    nextReviewAt: timestamp("next_review_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    // fk: setId -> flashcardSets(id)
    // fk: sourceChunkId -> chunks(id)
  },
  (t) => ({
    setIdIdx: index("idx_flashcards_set_id").on(t.setId),
    nextReviewIdx: index("idx_flashcards_next_review").on(t.nextReviewAt),
  }),
);

export const tests = pgTable("tests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  title: varchar("title", { length: 100 }),
  referenceFileId: uuid("ref_file_id").references(() => documents.id, {
    onDelete: "restrict",
  }), // the sample test file user uploaded
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // fk: userId -> auth.users(id)
  // referenceFileId -> documentts(id)
});

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

export type Course = typeof courses.$inferSelect;
export type NewCourse = typeof courses.$inferInsert;

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;

export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type MessageSource = typeof messageSources.$inferSelect;
export type NewMessageSource = typeof messageSources.$inferInsert;

export type FlashcardSet = typeof flashcardSets.$inferSelect;
export type NewFlashcardSet = typeof flashcardSets.$inferInsert;

export type Flashcard = typeof flashcards.$inferSelect;
export type NewFlashcard = typeof flashcards.$inferInsert;

export type Test = typeof tests.$inferSelect;
export type NewTest = typeof tests.$inferInsert;

export type NoteBook = typeof notebooks.$inferSelect;
export type NewNoteBook = typeof notebooks.$inferInsert;

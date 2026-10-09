/** Backend JSON contracts; maintained independently from frontend types.
 * Timestamps are serialized ISO strings, unlike database Date values. */
export type Course = {
  id: string;
  userId: string;
  name: string;
  code: string | null;
  semester: string | null;
  createdAt: string;
  updatedAt: string;
};
export type NoteBook = {
  id: string;
  userId: string;
  noteBookName: string;
  courseId: string | null;
};
export type Document = {
  id: string;
  userId: string;
  name: string;
  originalName: string;
  r2Key: string;
  fileType: string;
  fileSize: number;
  status: "pending" | "processing" | "ready" | "failed";
  errorMessage: string | null;
  courseId: string | null;
  notebookId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type FlashcardSet = {
  id: string;
  userId: string;
  documentId: string | null;
  title: string;
  courseId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type Flashcard = {
  id: string;
  setId: string;
  front: string;
  back: string;
  sourceChunkId: string | null;
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: string;
  createdAt: string;
  updatedAt: string;
};
export type Test = {
  id: string;
  userId: string;
  title: string | null;
  referenceFileId: string | null;
  createdAt: string;
  updatedAt: string;
};
/** Exact shape declared in backend/src/types/index.ts. */
export type SuccessfulPresignedUrlResponse = {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  expiresIn: number;
};
export type ApiError = { error: string };
export type CreateCourseInput = Pick<Course, "name" | "code" | "semester">;
export type CreateNotebookInput = Pick<NoteBook, "noteBookName"> & {
  courseId: string;
};
export type CreateSetInput = Pick<FlashcardSet, "title"> & {
  courseId: string | null;
};
export type CardInput = Pick<Flashcard, "front" | "back">;
/** Request for POST /api/flashcards/generate. */
export type GenerateFlashcardsInput = CreateSetInput & {
  documentId: string;
  count: number;
};
/** Request for POST /api/tests/generate. */
export type GenerateTestInput = {
  title: string;
  notebookId: string;
  mode: "notebook" | "reference";
  referenceFileId: string | null;
  referenceUrl: string | null;
};
/** Generated question content, persisted separately from Test metadata. */
export type TestQuestion = {
  id: string;
  prompt: string;
  answer: string;
  options: string[];
};
export type TestContent = {
  testId: string;
  instructions: string;
  questions: TestQuestion[];
};

import {
  and,
  asc,
  cosineDistance,
  eq,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  chatSessionDocuments,
  chatSessions,
  chunks,
  documents,
} from "../db/schema.js";

type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  tokenCount: number | null;
  score: number;
};

/** Embedding dimension (must be the same as ingestion)*/
export const EMBEDDING_DIMENSIONS = 2048;
export type EmbedQuery = (question: string) => Promise<number[]>;

const questionSchema = z.string().trim().min(1).max(8000);
const topKSchema = z.number().int().min(1).max(50);
const scoreSchema = z.number().finite().min(-1).max(1);
const embeddingSchema = z
  .array(z.number())
  .length(EMBEDDING_DIMENSIONS)
  .refine(
    (vector) => vector.some((value) => value !== 0),
    "Embedding must be nonzero",
  );

/** Treat missing and unowned sessions identically to avoid exposing other users' sessions. */
export class RetrievalSessionNotFoundError extends Error {
  /** Create an error that answerQuestion can translate to an HTTP 404. */
  constructor() {
    super("Chat session not found");
    this.name = "RetrievalSessionNotFoundError";
  }
}

/**
 * Embed the whole question without splitting it into document chunks.
 * @param question Question to trim and embed.
 * @param embed Adapter using the same model as stored document embeddings.
 * @returns A finite, nonzero vector matching the database dimensions.
 * @throws For invalid questions, invalid vectors, or provider failures.
 */
export const embedQuestion = async (
  question: string,
  embed: EmbedQuery,
): Promise<number[]> => {
  return embeddingSchema.parse(await embed(questionSchema.parse(question)));
};

/**
 * Verify session ownership and find its owned, ready documents.
 * @param userId Authenticated user ID from server authentication.
 * @param sessionId Session whose selected documents should be searched.
 * @returns Ready document IDs, or [] if none are ready.
 * @throws RetrievalSessionNotFoundError when the session is missing or unowned.
 */
export const getSessionDocumentIds = async (
  userId: string,
  sessionId: string,
): Promise<string[]> => {
  const scopeSchema = z.object({ userId: z.uuid(), sessionId: z.uuid() });
  scopeSchema.parse({ userId, sessionId });

  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
    .limit(1);

  if (!session) {
    throw new RetrievalSessionNotFoundError();
  }

  const rows = await db
    .select({ documentId: documents.id })
    .from(chatSessionDocuments)
    .innerJoin(documents, eq(documents.id, chatSessionDocuments.documentId))
    .where(
      and(
        eq(chatSessionDocuments.sessionId, sessionId),
        eq(documents.userId, userId),
        eq(documents.status, "ready"),
      ),
    );
  return rows.map((row) => row.documentId);
};

/**
 * Search chunks of owned, ready documents using cosine similarity.
 * @param options Query vector, authenticated user, allowed documents, limit (1–50), and optional score floor (-1–1).
 * @returns Up to topK passages, best first; score equals 1 minus cosine distance.
 * @throws For invalid options or database failures.
 */
export const searchSimilarChunks = async (options: {
  userId: string;
  documentIds: string[];
  embedding: number[];
  topK?: number;
  minScore?: number;
}): Promise<RetrievedChunk[]> => {
  const userId = z.uuid().parse(options.userId);
  const documentIds = z.array(z.uuid()).parse(options.documentIds);
  const embedding = embeddingSchema.parse(options.embedding);
  const topK = topKSchema.parse(options.topK ?? 6);
  const minScore =
    options.minScore === undefined
      ? undefined
      : scoreSchema.parse(options.minScore);

  // An empty document scope must never turn into an unrestricted search.
  if (documentIds.length === 0) return [];

  const distance = cosineDistance(chunks.embedding, embedding);
  const score = sql<number>`1 - (${distance})`.mapWith(Number);

  return db
    .select({
      chunkId: chunks.id,
      documentId: chunks.documentId,
      documentName: documents.name,
      content: chunks.content,
      chunkIndex: chunks.chunkIndex,
      pageNumber: chunks.pageNumber,
      tokenCount: chunks.tokenCount,
      score,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(
      and(
        eq(chunks.userId, userId),
        eq(documents.userId, userId),
        eq(documents.status, "ready"),
        inArray(chunks.documentId, documentIds),
        isNotNull(chunks.embedding),
        minScore === undefined ? undefined : sql`${score} >= ${minScore}`,
      ),
    )
    .orderBy(asc(distance), asc(chunks.id)) // most similar chunk on the top and then by chunk id
    .limit(topK);
};

/**
 * Retrieve sources for answerQuestion before generating the assistant response.
 * @param options Authenticated user, session, question, shared embedding adapter, and search settings.
 * @returns Ranked passages or [] when no ready documents or matches exist.
 * @throws For invalid input, inaccessible sessions, embedding failures, or database failures.
 */
export const retrieveForSession = async (options: {
  userId: string;
  sessionId: string;
  question: string;
  embedQuery: EmbedQuery;
  topK?: number;
  minScore?: number;
}): Promise<RetrievedChunk[]> => {
  const question = questionSchema.parse(options.question);
  const topK = topKSchema.parse(options.topK ?? 6);
  if (options.minScore !== undefined) {
    scoreSchema.parse(options.minScore);
  }

  // Verify access before sending a question to an external embedding provider.
  const documentIds = await getSessionDocumentIds(
    options.userId,
    options.sessionId,
  );

  if (documentIds.length === 0) return [];

  const embedding = await embedQuestion(question, options.embedQuery);

  return searchSimilarChunks({
    userId: options.userId,
    documentIds,
    embedding,
    topK,
    minScore: options.minScore,
  });
};
export { RetrievedChunk };

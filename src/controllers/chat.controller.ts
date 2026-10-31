import type { Request, Response } from "express";
import { db } from "../db/index.js";
import { Sentry } from "../config/sentry.js";
import { asc, eq, inArray, and, sql } from "drizzle-orm";
import {
  chatSessions,
  chatSessionDocuments,
  messages,
  documents,
  messageSources,
  chunks,
} from "../db/schema.js";
import { z } from "zod";
import {
  retrieveForSession,
  RetrievalSessionNotFoundError,
} from "../services/retrieval.service.js";
import { embedText } from "../config/openRouterAI.js";
import { generateAnswer } from "../services/answer.service.js";

/**
 * @description Create a new chat session with 1+ documents. This will create a new chat session in the database and return the session ID.
 * EndPoint: POST /chat/sessions
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const createNewChatSession = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const result = createChatSessionSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: "Invalid new chat session data",
        details: result.error.issues,
      });
      return;
    }

    const { documentIds, title } = result.data;

    const uniqueDocumentIds = [...new Set(documentIds)];

    const ownedDocuments = await db
      .select({ id: documents.id, status: documents.status })
      .from(documents)
      .where(
        and(
          inArray(documents.id, uniqueDocumentIds),
          eq(documents.userId, userId),
        ),
      );

    if (ownedDocuments.length !== uniqueDocumentIds.length) {
      res.status(404).json({
        error: "One or more documents were not found",
      });
      return;
    }

    if (ownedDocuments.some((document) => document.status !== "ready")) {
      res.status(409).json({ error: "All selected documents must be ready" });
      return;
    }

    const session = await db.transaction(async (tx) => {
      const [newSession] = await tx
        .insert(chatSessions)
        .values({ userId, title })
        .returning();

      await tx.insert(chatSessionDocuments).values(
        uniqueDocumentIds.map((documentId) => ({
          sessionId: newSession.id,
          documentId,
        })),
      );

      return newSession;
    });

    res.status(201).json({
      sessionId: session.id,
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "chat-session-create" } });
    res.status(500).json({
      error: "Failed to create new chat session",
    });
  }
};

const createChatSessionSchema = z.object({
  documentIds: z.array(z.uuid()).min(1),
  title: z.string().trim().min(1).max(255).optional(),
});

/**
 * @description Get all chat sessions for the user from the database. This will return a list of chat sessions as a JSON array of session objects. (id, metadata, messages)
 * EndPoint: GET /chat/sessions
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const getAllChatSessions = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId));

    if (sessions.length === 0) {
      res.status(200).json([]);
      return;
    }

    const sessionIds = sessions.map((session) => session.id);

    const sessionMessages = await db
      .select()
      .from(messages)
      .where(inArray(messages.sessionId, sessionIds))
      .orderBy(asc(messages.createdAt));

    const result = sessions.map((session) => ({
      ...session,
      messages: sessionMessages.filter(
        (message) => message.sessionId === session.id,
      ),
    }));

    res.status(200).json(result);
  } catch (error) {
    Sentry.captureException(error);

    res.status(500).json({
      error: "failed to retrieve chat sessions",
    });
  }
};

/**
 * @description Get a single chat session by its ID from the database. This will return the chat session as a JSON object. (id, metadata, messages)
 * EndPoint: GET /chat/sessions/:id
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const getSingleChatSession = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({
      error: "Unauthorized user",
    });
    return;
  }

  const result = z.uuid().safeParse(req.params.id);

  if (!result.success) {
    res.status(400).json({
      error: "Invalid session id",
    });
    return;
  }

  try {
    const reqSessionId = result.data;

    const [reqChatSession] = await db
      .select()
      .from(chatSessions)
      .where(
        and(eq(chatSessions.id, reqSessionId), eq(chatSessions.userId, userId)),
      );

    if (!reqChatSession) {
      res.status(404).json({
        error: "Chat session not found",
      });
      return;
    }

    const chatSessionMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, reqSessionId))
      .orderBy(
        asc(messages.createdAt),
        sql`case when ${messages.role} = 'user' then 0 else 1 end`,
        asc(messages.id),
      );

    const sessionDocuments = await db
      .select({ id: documents.id })
      .from(chatSessionDocuments)
      .innerJoin(documents, eq(documents.id, chatSessionDocuments.documentId))
      .where(
        and(
          eq(chatSessionDocuments.sessionId, reqSessionId),
          eq(documents.userId, userId),
        ),
      );

    const messageIds = chatSessionMessages.map((message) => message.id);
    const citedSources =
      messageIds.length === 0
        ? []
        : await db
            .select({
              messageId: messageSources.messageId,
              chunkId: chunks.id,
              documentId: documents.id,
              documentName: documents.name,
              pageNumber: chunks.pageNumber,
              content: chunks.content,
              score: messageSources.score,
            })
            .from(messageSources)
            .innerJoin(chunks, eq(chunks.id, messageSources.chunkId))
            .innerJoin(documents, eq(documents.id, chunks.documentId))
            .where(
              and(
                inArray(messageSources.messageId, messageIds),
                eq(documents.userId, userId),
              ),
            );

    res.status(200).json({
      ...reqChatSession,
      documentIds: sessionDocuments.map((document) => document.id),
      messages: chatSessionMessages.map((message) => ({
        ...message,
        sources: citedSources.filter(
          (source) => source.messageId === message.id,
        ),
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to retrieve chat session",
    });
  }
};

/**
 * @description Delete a chat session by its ID from the database. This will delete the chat session and all its messages.
 * EndPoint: DELETE /chat/sessions/:id
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const deleteChatSession = async (req: Request, res: Response) => {};

/**
 * @description Answer a question using the session ID and the message from the request body
 * EndPoint: POST /chat/sessions/:id/messages
 *
 * @param req - Express Request object
 * @param res - Express Response object
 */
export const answerQuestion = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sessionId = z.uuid().safeParse(req.params.id);
  const body = z
    .object({ message: z.string().trim().min(1).max(8000) })
    .safeParse(req.body);

  if (!sessionId.success || !body.success) {
    res.status(400).json({ error: "Invalid session ID or message" });
    return;
  }

  try {
    const chunks = await retrieveForSession({
      userId,
      sessionId: sessionId.data,
      question: body.data.message,
      embedQuery: embedText,
    });

    const answer = await generateAnswer(body.data.message, chunks);

    // Save the complete exchange and cited chunks atomically after generation succeeds.
    const saved = await db.transaction(async (tx) => {
      const [userMessage] = await tx
        .insert(messages)
        .values({
          sessionId: sessionId.data,
          role: "user",
          content: body.data.message,
        })
        .returning();

      const [assistantMessage] = await tx
        .insert(messages)
        .values({
          sessionId: sessionId.data,
          role: "assistant",
          content: answer.answer,
        })
        .returning();

      if (answer.sources.length) {
        await tx.insert(messageSources).values(
          answer.sources.map((source) => ({
            messageId: assistantMessage.id,
            chunkId: source.chunkId,
            score: source.score,
          })),
        );
      }

      await tx
        .update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(chatSessions.id, sessionId.data),
            eq(chatSessions.userId, userId),
          ),
        );

      return { userMessage, assistantMessage };
    });
    res.status(201).json({ ...saved, ...answer });
  } catch (error) {
    if (error instanceof RetrievalSessionNotFoundError) {
      res.status(404).json({ error: "Chat session not found" });
      return;
    }

    Sentry.captureException(error, { tags: { area: "chat-answer" } });
    res.status(500).json({ error: "Failed to answer question" });
  }
};

import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "../../src/db/index.js";
import {
  embedQuestion,
  retrieveForSession,
  searchSimilarChunks,
  RetrievalSessionNotFoundError,
} from "../../src/services/retrieval.service.js";

jest.mock("../../src/db/index.js", () => ({ db: { select: jest.fn() } }));
const userId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const documentId = "00000000-0000-4000-8000-000000000003";
const vector = Array.from({ length: 2048 }, () => 0.1);

/** Queue a fluent database response while preserving SQL expressions for assertions. */
const queueQuery = (rows: unknown[]) => {
  const query = {
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(rows),
    then: (resolve: (value: unknown[]) => unknown) =>
      Promise.resolve(rows).then(resolve),
  };
  jest.mocked(db.select).mockReturnValueOnce(query as never);
  return query;
};

beforeEach(() => jest.resetAllMocks());

describe("retrieval service", () => {
  it("embeds a trimmed question and rejects malformed provider vectors", async () => {
    const embed = jest.fn().mockResolvedValue(vector);
    await expect(embedQuestion("  question  ", embed)).resolves.toEqual(vector);
    expect(embed).toHaveBeenCalledWith("question");
    for (const invalid of [
      [],
      [1],
      Array(2048).fill(0),
      Array(2048).fill(NaN),
    ]) {
      await expect(
        embedQuestion("question", jest.fn().mockResolvedValue(invalid)),
      ).rejects.toThrow();
    }
  });

  it("rejects inaccessible sessions before calling the embedding provider", async () => {
    queueQuery([]);
    const embedQuery = jest.fn();
    await expect(
      retrieveForSession({
        userId,
        sessionId,
        question: "question",
        embedQuery,
      }),
    ).rejects.toBeInstanceOf(RetrievalSessionNotFoundError);
    expect(embedQuery).not.toHaveBeenCalled();
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("skips embedding and chunk search when no documents are ready", async () => {
    queueQuery([{ id: sessionId }]);
    queueQuery([]);
    const embedQuery = jest.fn();
    await expect(
      retrieveForSession({
        userId,
        sessionId,
        question: "question",
        embedQuery,
      }),
    ).resolves.toEqual([]);
    expect(embedQuery).not.toHaveBeenCalled();
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("scopes session and chunk queries to the owner and selected ready documents", async () => {
    const session = queueQuery([{ id: sessionId }]);
    const documents = queueQuery([{ documentId }]);
    const result = [
      { chunkId: "chunk", documentId, content: "source", score: 0.9 },
    ];
    const search = queueQuery(result);
    await expect(
      retrieveForSession({
        userId,
        sessionId,
        question: "question",
        embedQuery: async () => vector,
        topK: 3,
        minScore: 0.5,
      }),
    ).resolves.toEqual(result);
    const dialect = new PgDialect();
    const sessionSQL = dialect.sqlToQuery(session.where.mock.calls[0][0]);
    expect(sessionSQL.params).toEqual([sessionId, userId]);
    const documentSQL = dialect.sqlToQuery(documents.where.mock.calls[0][0]);
    expect(documentSQL.params).toEqual([sessionId, userId, "ready"]);
    const searchSQL = dialect.sqlToQuery(search.where.mock.calls[0][0]);
    expect(searchSQL.params).toEqual(
      expect.arrayContaining([userId, documentId, "ready", 0.5]),
    );
    expect(searchSQL.sql).toContain('"chunks"."user_id"');
    expect(searchSQL.sql).toContain('"documents"."user_id"');
    expect(searchSQL.sql).toContain('"chunks"."embedding" is not null');
    expect(search.limit).toHaveBeenCalledWith(3);
    expect(dialect.sqlToQuery(search.orderBy.mock.calls[0][0]).sql).toContain(
      "<=>",
    );
  });

  it("never searches all documents for an empty scope", async () => {
    await expect(
      searchSimilarChunks({ userId, documentIds: [], embedding: vector }),
    ).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects invalid questions and limits before any database or provider work", async () => {
    const embedQuery = jest.fn();
    for (const options of [
      { question: " " },
      { topK: 0 },
      { topK: 51 },
      { minScore: 2 },
    ]) {
      await expect(
        retrieveForSession({
          userId,
          sessionId,
          question: "question",
          embedQuery,
          ...options,
        }),
      ).rejects.toThrow();
    }
    expect(db.select).not.toHaveBeenCalled();
    expect(embedQuery).not.toHaveBeenCalled();
  });
});

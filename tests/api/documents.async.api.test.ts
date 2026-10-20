import process from "node:process";
import {
  request,
  error,
  record,
  resources,
  pollDocument,
  otherToken,
  randomUUID,
} from "../helpers/api.js";
import { afterEach, expect, test } from "@jest/globals";
import "dotenv/config";

const cleanup = resources();
afterEach(() => cleanup.clean());

test("presigning rejects files above the documented 20 MiB limit", async () => {
  error(
    await request("POST", "/api/documents/presign", {
      fileName: "large.txt",
      contentType: "text/plain",
      size: 20 * 1024 * 1024 + 1,
    }),
    400,
  );
});

test("presigning accepts the exact size boundary and returns the public contract", async () => {
  const result = await request("POST", "/api/documents/presign", {
    fileName: "boundary.txt",
    contentType: "text/plain",
    size: 20 * 1024 * 1024,
  });
  expect(result.status).toBe(200);
  expect(result.data).toEqual({
    uploadUrl: expect.any(String),
    key: expect.any(String),
    expiresIn: 3600,
  });
  expect(new URL(result.data.uploadUrl).protocol).toBe("https:");
});

test("uploaded text is accepted asynchronously, isolated by owner and eventually ready", async () => {
  const courseId = process.env.TEST_COURSE_ID;
  const notebookId = process.env.TEST_NOTEBOOK_ID;
  if (!courseId || !notebookId)
    throw new Error(
      "Async upload requires TEST_COURSE_ID and TEST_NOTEBOOK_ID owned by TEST_USER_TOKEN.",
    );
  const fileName = `jest-${randomUUID()}.txt`;
  const content =
    "Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs light in chloroplasts. Plants consume carbon dioxide and release oxygen.";
  const size = Buffer.byteLength(content);
  const signed = await request("POST", "/api/documents/presign", {
    fileName,
    contentType: "text/plain",
    size,
  });
  expect(signed.status).toBe(200);
  expect(signed.data).toEqual({
    uploadUrl: expect.any(String),
    key: expect.any(String),
    expiresIn: 3600,
  });
  const upload = await fetch(signed.data.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: content,
    signal: AbortSignal.timeout(10000),
  });
  expect(upload.ok).toBe(true);
  const body = {
    name: fileName,
    originalName: fileName,
    r2Key: signed.data.key,
    fileType: "txt",
    fileSize: size,
    courseId,
    notebookId,
  };
  // Another user cannot confirm a file uploaded under the first user's key.
  const foreign = await request(
    "POST",
    "/api/documents/confirm",
    body,
    otherToken,
  );
  if (foreign.data?.documentId)
    cleanup.track(`/api/documents/${foreign.data.documentId}`);
  error(foreign, 404);
  const accepted = await request("POST", "/api/documents/confirm", body);
  if (accepted.data?.documentId)
    cleanup.track(`/api/documents/${accepted.data.documentId}`);
  expect(accepted.status).toBe(202);
  expect(accepted.data).toEqual({
    documentId: expect.any(String),
    status: "queued",
  });
  const path = `/api/documents/${accepted.data.documentId}`;
  error(await request("GET", path, undefined, otherToken), 404);
  error(await request("PATCH", path, { name: "Forbidden" }, otherToken), 404);
  error(await request("DELETE", path, undefined, otherToken), 404);
  // Do not require observing every transient state: a fast worker can finish
  // before the first poll. A failed job is terminal, but fails this happy path.
  const finished = await pollDocument(accepted.data.documentId);
  record(finished, body);
  expect(finished.status).toBe("ready");
  expect(finished.errorMessage).toBeNull();
  const renamed = await request("PATCH", path, { name: "Renamed study notes" });
  expect(renamed.status).toBe(200);
  expect(renamed.data).toMatchObject({
    id: finished.id,
    name: "Renamed study notes",
    originalName: fileName,
    r2Key: signed.data.key,
  });
  const listed = await request("GET", "/api/documents");
  expect(listed.status).toBe(200);
  expect(listed.data).toEqual(expect.arrayContaining([renamed.data]));

  const generated = await request("POST", "/api/flashcards/generate", {
    title: `Generated ${randomUUID()}`,
    courseId,
    documentId: finished.id,
    count: 3,
  });
  if (generated.data?.id) cleanup.track(`/api/flashcards/${generated.data.id}`);
  expect(generated.status).toBe(201);
  record(generated.data, { documentId: finished.id, courseId });
  const cards = await request("GET", `/api/flashcards/${generated.data.id}`);
  expect(cards.status).toBe(200);
  expect(cards.data).toHaveLength(3);
  for (const card of cards.data) {
    expect(card).toMatchObject({
      setId: generated.data.id,
      front: expect.any(String),
      back: expect.any(String),
    });
    expect(card.front.trim()).not.toBe("");
    expect(card.back.trim()).not.toBe("");
  }

  const testInput = {
    title: `Generated test ${randomUUID()}`,
    notebookId,
    mode: "notebook",
    referenceFileId: null,
    referenceUrl: null,
  };
  const generatedTest = await request("POST", "/api/tests/generate", testInput);
  if (generatedTest.data?.id)
    cleanup.track(`/api/tests/${generatedTest.data.id}`);
  expect(generatedTest.status).toBe(201);
  record(generatedTest.data, { title: testInput.title, referenceFileId: null });
  const testPath = `/api/tests/${generatedTest.data.id}`;
  expect(await request("GET", testPath)).toMatchObject({
    status: 200,
    data: generatedTest.data,
  });
  const tests = await request("GET", "/api/tests");
  expect(tests.status).toBe(200);
  expect(tests.data).toEqual(expect.arrayContaining([generatedTest.data]));
  error(await request("GET", testPath, undefined, otherToken), 404);
  error(
    await request("GET", `${testPath}/content`, undefined, otherToken),
    404,
  );
  error(await request("DELETE", testPath, undefined, otherToken), 404);
  const questions = await request("GET", `${testPath}/content`);
  expect(questions.status).toBe(200);
  expect(questions.data).toMatchObject({
    testId: generatedTest.data.id,
    instructions: expect.any(String),
    questions: expect.any(Array),
  });
  expect(questions.data.questions.length).toBeGreaterThan(0);
  for (const question of questions.data.questions) {
    expect(question).toMatchObject({
      id: expect.any(String),
      prompt: expect.any(String),
      answer: expect.any(String),
      options: expect.any(Array),
    });
    expect(question.prompt.trim()).not.toBe("");
    expect(question.answer.trim()).not.toBe("");
    for (const option of question.options) expect(typeof option).toBe("string");
  }
  expect(await request("DELETE", testPath)).toMatchObject({
    status: 204,
    text: "",
  });
  error(await request("GET", `${testPath}/content`), 404);
  expect(
    await request("DELETE", `/api/flashcards/${generated.data.id}`),
  ).toMatchObject({ status: 204, text: "" });
  expect(await request("DELETE", path)).toMatchObject({
    status: 204,
    text: "",
  });
  error(await request("GET", path), 404);
});

import { describe, it } from "@jest/globals";
import { randomUUID, request, error } from "../helpers/api.js";

const id = randomUUID();
const endpoints: [string, string][] = [
  ["GET", "/api/courses"],
  ["POST", "/api/courses"],
  ["GET", `/api/courses/${id}`],
  ["DELETE", `/api/courses/${id}`],
  ["GET", "/api/notebooks"],
  ["POST", "/api/notebooks"],
  ["POST", "/api/documents/presign"],
  ["POST", "/api/documents/confirm"],
  ["GET", "/api/documents"],
  ["GET", `/api/documents/${id}`],
  ["PATCH", `/api/documents/${id}`],
  ["DELETE", `/api/documents/${id}`],
  ["GET", "/api/chat/sessions"],
  ["POST", "/api/chat/sessions"],
  ["GET", `/api/chat/sessions/${id}`],
  ["DELETE", `/api/chat/sessions/${id}`],
  ["GET", "/api/flashcards"],
  ["POST", "/api/flashcards"],
  ["POST", "/api/flashcards/generate"],
  ["GET", `/api/flashcards/${id}`],
  ["DELETE", `/api/flashcards/${id}`],
  ["POST", `/api/flashcards/${id}/cards`],
  ["PATCH", `/api/flashcards/${id}/cards/${id}`],
  ["DELETE", `/api/flashcards/${id}/cards/${id}`],
  ["GET", "/api/tests"],
  ["POST", "/api/tests/generate"],
  ["GET", `/api/tests/${id}`],
  ["GET", `/api/tests/${id}/content`],
  ["DELETE", `/api/tests/${id}`],
];

describe.each<[string, string | null]>([
  ["missing", null],
  ["invalid", "invalid-test-token"],
])("%s authentication", (_label, auth) => {
  it.each(endpoints)(
    "%s %s rejects access before processing input",
    async (method, path) => {
      error(
        await request(
          method,
          path,
          method === "POST" || method === "PATCH" ? {} : undefined,
          auth,
        ),
        401,
      );
    },
  );
});

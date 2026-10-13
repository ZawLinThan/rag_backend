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
import {afterEach, expect, test} from '@jest/globals'; 
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


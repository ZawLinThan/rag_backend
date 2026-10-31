import { chatStructured } from "../../src/config/openRouterAI.js";
import { generateAnswer } from "../../src/services/answer.service.js";
import type { RetrievedChunk } from "../../src/services/retrieval.service.js";
jest.mock("../../src/config/openRouterAI.js", () => ({
  chatStructured: jest.fn(),
}));
const chunk: RetrievedChunk = {
  chunkId: "source-1",
  documentId: "doc",
  documentName: "Notes",
  content: "Evidence",
  chunkIndex: 0,
  pageNumber: 1,
  tokenCount: 2,
  score: 0.9,
};
beforeEach(() => jest.clearAllMocks());
it("avoids a model call when retrieval returns no sources", async () => {
  expect((await generateAnswer("question", [])).sources).toEqual([]);
  expect(chatStructured).not.toHaveBeenCalled();
});
it("passes source text to the model and returns deduplicated verified citations", async () => {
  jest.mocked(chatStructured).mockResolvedValue({
    answer: "Answer [source-1]",
    chunkIds: ["source-1", "source-1"],
  });
  expect(await generateAnswer("question", [chunk])).toEqual({
    answer: "Answer [source-1]",
    sources: [chunk],
  });
  expect(chatStructured).toHaveBeenCalledWith(
    expect.objectContaining({
      input: {
        question: "question",
        sources: [
          {
            chunkId: chunk.chunkId,
            documentName: chunk.documentName,
            pageNumber: 1,
            content: "Evidence",
          },
        ],
      },
    }),
  );
});
it("rejects citations invented by the model", async () => {
  jest
    .mocked(chatStructured)
    .mockResolvedValue({ answer: "Answer", chunkIds: ["unknown"] });
  await expect(generateAnswer("question", [chunk])).rejects.toThrow(
    "unknown source",
  );
});
it("propagates provider failures without returning a fabricated answer", async () => {
  jest
    .mocked(chatStructured)
    .mockRejectedValue(new Error("provider unavailable"));
  await expect(generateAnswer("question", [chunk])).rejects.toThrow(
    "provider unavailable",
  );
});

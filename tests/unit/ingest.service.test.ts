import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import JSZip from "jszip";

jest.mock("../../src/db/index.js", () => ({
  db: { select: jest.fn(), update: jest.fn() },
}));

jest.mock("../../src/config/sentry.js", () => ({
  Sentry: { captureException: jest.fn(), startSpan: jest.fn() },
}));

jest.mock("node:child_process", () => ({
  spawn: jest.fn(),
}));

import { extractText } from "../../src/services/ingest.service.js";
import { spawn } from "node:child_process";

const spawnMock = jest.mocked(spawn);
const originalMineruCommand = process.env.MINERU_COMMAND;
const originalMineruTier = process.env.MINERU_TIER;
const originalMineruTimeout = process.env.MINERU_TIMEOUT_MS;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.MINERU_COMMAND;
  delete process.env.MINERU_TIER;
  delete process.env.MINERU_TIMEOUT_MS;
});

afterEach(() => {
  const restoreEnvironmentVariable = (
    name: string,
    originalValue: string | undefined,
  ): void => {
    if (originalValue === undefined) {
      delete process.env[name];
      return;
    }

    process.env[name] = originalValue;
  };

  restoreEnvironmentVariable("MINERU_COMMAND", originalMineruCommand);
  restoreEnvironmentVariable("MINERU_TIER", originalMineruTier);
  restoreEnvironmentVariable("MINERU_TIMEOUT_MS", originalMineruTimeout);
});

const mineruChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    kill: jest.Mock;
    stderr: EventEmitter;
    stdout: EventEmitter;
  };
  child.kill = jest.fn();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
};

const escapePdfString = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const createPdf = (text: string): Buffer => {
  const content = `BT\n/F1 16 Tf\n72 720 Td\n(${escapePdfString(text)}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "ascii");
};

const createDocx = async (documentXml: string): Promise<Buffer> => {
  const archive = new JSZip();
  archive.file("word/document.xml", documentXml);
  return archive.generateAsync({ type: "nodebuffer" });
};

it("extracts selectable PDF text and retains its page boundary for RAG chunks", async () => {
  const text = await extractText(
    createPdf("Pythagoras: x^2 + y^2 = z^2"),
    "application/pdf",
  );

  expect(text).toBe("--- Page 1 ---\nPythagoras: x^2 + y^2 = z^2");
  expect(spawnMock).not.toHaveBeenCalled();
});

it("uses local MinerU Markdown for a PDF explicitly marked as containing formulas", async () => {
  const child = mineruChild();
  spawnMock.mockImplementation((_command, args) => {
    const outputPath = (args as string[])[(args as string[]).indexOf("-o") + 1];

    void writeFile(outputPath, "# Notes\n\n$$\\frac{r}{1-r}$$\n", "utf8").then(
      () => child.emit("close", 0, null),
    );
    return child as never;
  });

  await expect(
    extractText(createPdf("formula"), "application/pdf", {
      hasMathFormula: true,
    }),
  ).resolves.toBe("# Notes\n\n$$\\frac{r}{1-r}$$");

  expect(spawnMock).toHaveBeenCalledWith(
    "mineru-kit",
    expect.arrayContaining([
      "parse",
      expect.stringMatching(/document\.pdf$/),
      "-o",
      expect.stringMatching(/document\.md$/),
      "--tier",
      "advanced",
    ]),
    expect.objectContaining({ shell: false, windowsHide: true }),
  );
});

it("does not fall back to lossy PDF text when MinerU fails", async () => {
  const child = mineruChild();
  spawnMock.mockImplementation(() => {
    queueMicrotask(() => {
      child.stderr.emit("data", Buffer.from("model unavailable"));
      child.emit("close", 1, null);
    });
    return child as never;
  });

  await expect(
    extractText(createPdf("formula"), "pdf", { hasMathFormula: true }),
  ).rejects.toThrow("MinerU failed with exit code 1: model unavailable");
});

it("extracts DOCX prose and a readable Office Math representation", async () => {
  const document = await createDocx(`<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
      <w:body>
        <w:p>
          <w:r><w:t>Area equals </w:t></w:r>
          <m:oMath><m:sSup><m:e><m:r><m:t>r</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>
        </w:p>
        <w:p>
          <w:r><w:t>Ratio </w:t></w:r>
          <m:oMath><m:f><m:num><m:r><m:t>x</m:t></m:r></m:num><m:den><m:r><m:t>y</m:t></m:r></m:den></m:f></m:oMath>
        </w:p>
      </w:body>
    </w:document>`);

  await expect(
    extractText(
      document,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  ).resolves.toBe(
    "Area equals [[equation: r^(2)]]\n\nRatio [[equation: (x) / (y)]]",
  );
});

it("preserves Unicode plain text", async () => {
  await expect(
    extractText(Buffer.from("\uFEFFπ ≤ ∑ n\r\n", "utf8"), "text/plain"),
  ).resolves.toBe("π ≤ ∑ n");
});

it("does not silently index an empty image-only or unsupported document", async () => {
  await expect(extractText(createPdf(""), "pdf")).rejects.toThrow(
    "image-only documents require OCR, which is not enabled",
  );
  await expect(
    extractText(Buffer.from("content"), "application/epub+zip"),
  ).rejects.toThrow("Unsupported document type");
});

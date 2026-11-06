import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "bullmq";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { db } from "../db/index.js";
import { chunks as chunksTable, documents } from "../db/schema.js";
import type { Document, DocumentStatus, NewChunk } from "../db/schema.js";
import type { DocumentJob } from "../queue/document.queue.js";
import { eq } from "drizzle-orm";
import { embedText } from "../config/openRouterAI.js";
import { Sentry } from "../config/sentry.js";
import { PermanentError } from "../lib/errors.js";
import { beforeProviderCall } from "../lib/providerCalls.js";
import { scheduleProviderRequest } from "../lib/providerRateLimit.js";

type TextChunk = Pick<
  NewChunk,
  "content" | "chunkIndex" | "pageNumber" | "tokenCount"
>;

type EmbeddedChunk = TextChunk & {
  embedding: NonNullable<NewChunk["embedding"]>;
};

const MAX_PDF_PAGES = 200;
const MAX_PDF_IMAGE_PIXELS = 16_777_216;
const MAX_EXTRACTED_CHARACTERS = 2_000_000;
const MAX_DOCX_XML_CHARACTERS = 4_000_000;
const DEFAULT_MINERU_TIMEOUT_MS = 30 * 60 * 1_000;
const MAX_MINERU_LOG_CHARACTERS = 10_000;

type XmlNode = Record<string, unknown>;
type XmlNodes = XmlNode[];
type MineruTier = "basic" | "standard" | "advanced";

type ExtractTextOptions = {
  hasMathFormula?: boolean;
};

// DOCX files are ZIP archives. The body and Office Math markup live in
// word/document.xml; preserveOrder keeps text and equations in reading order.
const docxParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  maxNestedTags: 128,
  processEntities: {
    maxEntitySize: 10_000,
    maxTotalExpansions: 1_000,
    maxExpandedLength: 100_000,
  },
});
/** Vector width the chunks table expects. */
const EMBEDDING_DIMENSIONS = 2048;

/** Rows per insert statement. */
const INSERT_BATCH_SIZE = 100;

// Download the document's bytes from R2.
const downloadFromR2 = async (_r2Key: string): Promise<Buffer> => {
  throw new Error("downloadFromR2 is not implemented");
};

type SupportedFileType = "pdf" | "docx" | "txt";

const normaliseFileType = (fileType: string): SupportedFileType => {
  switch (fileType.trim().toLowerCase()) {
    case "pdf":
    case ".pdf":
    case "application/pdf":
      return "pdf";
    case "docx":
    case ".docx":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "txt":
    case ".txt":
    case "text/plain":
      return "txt";
    default:
      throw new Error(`Unsupported document type: ${fileType}`);
  }
};

const normaliseText = (text: string): string =>
  text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

const requireExtractedText = (text: string, source: string): string => {
  const normalised = normaliseText(text).trim();

  if (!normalised) {
    throw new Error(
      `${source} contains no extractable text; image-only documents require OCR, which is not enabled.`,
    );
  }

  if (normalised.length > MAX_EXTRACTED_CHARACTERS) {
    throw new Error(
      `${source} extracted text exceeds the ${MAX_EXTRACTED_CHARACTERS.toLocaleString()} character limit.`,
    );
  }

  return normalised;
};

const asXmlNodes = (value: unknown): XmlNodes =>
  Array.isArray(value) ? (value as XmlNodes) : [];

const childrenFor = (node: XmlNode, tagName: string): XmlNodes =>
  asXmlNodes(node[tagName]);

const textFromXmlNodes = (nodes: XmlNodes): string =>
  nodes
    .map((node) => {
      if (typeof node["#text"] === "string") {
        return node["#text"];
      }

      return Object.entries(node)
        .filter(([tagName]) => tagName !== ":@")
        .map(([, children]) => textFromXmlNodes(asXmlNodes(children)))
        .join("");
    })
    .join("");

// This is intentionally a small, readable representation of the Office Math
// constructs most common in notes. It does not claim to be LaTeX or MathML.
const ommlToText = (nodes: XmlNodes): string =>
  nodes
    .map((node) => {
      const tagName = Object.keys(node).find(
        (key) => key !== ":@" && key !== "#text",
      );

      if (!tagName) {
        return typeof node["#text"] === "string" ? node["#text"] : "";
      }

      const children = childrenFor(node, tagName);
      const part = (name: string): string =>
        children
          .filter((child) => child[name])
          .map((child) => ommlToText(childrenFor(child, name)))
          .join("");

      switch (tagName) {
        case "m:f": {
          const numerator = part("m:num");
          const denominator = part("m:den");
          return numerator || denominator
            ? `(${numerator}) / (${denominator})`
            : "";
        }
        case "m:sSup": {
          const base = part("m:e");
          const superscript = part("m:sup");
          return superscript ? `${base}^(${superscript})` : base;
        }
        case "m:sSub": {
          const base = part("m:e");
          const subscript = part("m:sub");
          return subscript ? `${base}_(${subscript})` : base;
        }
        case "m:sSubSup": {
          const base = part("m:e");
          const subscript = part("m:sub");
          const superscript = part("m:sup");
          return `${base}${subscript ? `_(${subscript})` : ""}${
            superscript ? `^(${superscript})` : ""
          }`;
        }
        case "m:rad": {
          const degree = part("m:deg");
          const expression = part("m:e");
          return degree
            ? `root(${degree}, ${expression})`
            : `sqrt(${expression})`;
        }
        case "m:oMath":
          return `[[equation: ${ommlToText(children)}]]`;
        default:
          return ommlToText(children);
      }
    })
    .join("");

const wordprocessingMlToText = (nodes: XmlNodes): string =>
  nodes
    .map((node) => {
      const tagName = Object.keys(node).find(
        (key) => key !== ":@" && key !== "#text",
      );

      if (!tagName) {
        return "";
      }

      const children = childrenFor(node, tagName);

      switch (tagName) {
        case "w:t":
          return textFromXmlNodes(children);
        case "w:tab":
          return "\t";
        case "w:br":
        case "w:cr":
          return "\n";
        case "w:p":
          return `${wordprocessingMlToText(children).trim()}\n\n`;
        case "m:oMath":
          return ommlToText([{ [tagName]: children }]);
        case "m:oMathPara":
          return `${ommlToText(children)}\n\n`;
        default:
          return wordprocessingMlToText(children);
      }
    })
    .join("");

const getMineruTier = (): MineruTier => {
  const configuredTier = process.env.MINERU_TIER?.trim().toLowerCase();

  if (!configuredTier) {
    return "advanced";
  }

  if (
    configuredTier === "basic" ||
    configuredTier === "standard" ||
    configuredTier === "advanced"
  ) {
    return configuredTier;
  }

  throw new Error("MINERU_TIER must be one of: basic, standard, or advanced.");
};

const getMineruTimeoutMs = (): number => {
  const configuredTimeout = process.env.MINERU_TIMEOUT_MS;

  if (!configuredTimeout) {
    return DEFAULT_MINERU_TIMEOUT_MS;
  }

  const timeoutMs = Number(configuredTimeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("MINERU_TIMEOUT_MS must be a positive integer.");
  }

  return timeoutMs;
};

const appendMineruLog = (current: string, data: Buffer | string): string =>
  `${current}${data.toString()}`.slice(-MAX_MINERU_LOG_CHARACTERS);

const runMineru = async (
  inputPath: string,
  outputPath: string,
): Promise<void> => {
  const command = process.env.MINERU_COMMAND?.trim() || "mineru-kit";
  const tier = getMineruTier();
  const timeoutMs = getMineruTimeoutMs();
  const args = ["parse", inputPath, "-o", outputPath, "--tier", tier];

  await new Promise<void>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(
        new Error(
          `MinerU did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`,
        ),
      );
    }, timeoutMs);

    child.stdout?.on("data", (data: Buffer) => {
      stdout = appendMineruLog(stdout, data);
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr = appendMineruLog(stderr, data);
    });
    child.on("error", (error) => {
      finish(
        new Error(
          `Could not start MinerU command "${command}". Install MinerU or set MINERU_COMMAND to the local mineru-kit executable.`,
          { cause: error },
        ),
      );
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }

      const diagnostics = (stderr || stdout).trim();
      finish(
        new Error(
          `MinerU failed${signal ? ` (${signal})` : ` with exit code ${code}`}${
            diagnostics ? `: ${diagnostics}` : ""
          }`,
        ),
      );
    });
  });
};

const extractPdfWithMineru = async (file: Buffer): Promise<string> => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "rag-mineru-"));
  const inputPath = join(temporaryDirectory, "document.pdf");
  const outputPath = join(temporaryDirectory, "document.md");

  try {
    await writeFile(inputPath, file);
    await runMineru(inputPath, outputPath);
    return requireExtractedText(
      await readFile(outputPath, "utf8"),
      "MinerU PDF",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

const extractPdf = async (file: Buffer): Promise<string> => {
  const pdf = await getDocumentProxy(new Uint8Array(file), {
    maxImageSize: MAX_PDF_IMAGE_PIXELS,
  });

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF exceeds the ${MAX_PDF_PAGES} page limit.`);
    }

    const { text } = await extractPdfText(pdf, { mergePages: false });
    const pages = text
      .map((page, index) => {
        const pageText = normaliseText(page).trim();
        return pageText ? `--- Page ${index + 1} ---\n${pageText}` : "";
      })
      .filter(Boolean);

    return requireExtractedText(pages.join("\n\n"), "PDF");
  } finally {
    await pdf.loadingTask.destroy();
  }
};

const extractDocx = async (file: Buffer): Promise<string> => {
  const archive = await JSZip.loadAsync(file, { checkCRC32: true });
  const documentXml = archive.file("word/document.xml");

  if (!documentXml) {
    throw new Error("DOCX is missing word/document.xml.");
  }

  const xml = await documentXml.async("string");
  if (xml.length > MAX_DOCX_XML_CHARACTERS) {
    throw new Error(
      `DOCX XML exceeds the ${MAX_DOCX_XML_CHARACTERS.toLocaleString()} character limit.`,
    );
  }

  return requireExtractedText(
    wordprocessingMlToText(asXmlNodes(docxParser.parse(xml))),
    "DOCX",
  );
};

/**
 * TODO(frontend): add a required \"contains mathematical formulas\" choice to
 * upload confirmation. Persist it as documents.hasMathFormula; false keeps the
 * normal text-only path, while true uses local MinerU and its LaTeX Markdown.
 */
export const extractText = async (
  file: Buffer,
  fileType: Document["fileType"],
  { hasMathFormula = false }: ExtractTextOptions = {},
): Promise<string> => {
  switch (normaliseFileType(fileType)) {
    case "pdf":
      return hasMathFormula ? extractPdfWithMineru(file) : extractPdf(file);
    case "docx":
      return extractDocx(file);
    case "txt":
      return requireExtractedText(file.toString("utf8"), "Text file");
  }
};

// Split extracted text into chunks before database IDs are assigned.
const chunkText = (_text: string): TextChunk[] => {
  throw new Error("chunkText is not implemented");
};

// Associate each chunk with its embedding vector.
const embedChunks = async (
  textChunks: readonly TextChunk[],
): Promise<EmbeddedChunk[]> => {
  const embedded: EmbeddedChunk[] = [];

  for (const chunk of textChunks) {
    const embedding = await scheduleProviderRequest(
      "openrouter",
      Math.ceil(chunk.content.length / 4),
      async () => {
        await beforeProviderCall();
        return embedText(chunk.content);
      },
    );

    if (
      embedding.length !== EMBEDDING_DIMENSIONS ||
      !embedding.every(Number.isFinite) ||
      !embedding.some((value) => value !== 0)
    ) {
      throw new PermanentError(
        `Embedding must be a finite, nonzero ${EMBEDDING_DIMENSIONS}-dimension vector.`,
      );
    }
    embedded.push({ ...chunk, embedding });
  }

  return embedded;
};

// Store embedded chunks with their document and user ownership.
const storeChunks = async (
  documentId: Document["id"],
  userId: Document["userId"],
  embeddedChunks: readonly EmbeddedChunk[],
): Promise<void> => {
  await db.transaction(async (tx) => {
    // Clear rows from an earlier attempt; (documentID, chunkIndex) is unique.
    await tx.delete(chunksTable).where(eq(chunksTable.documentId, documentId));

    for (
      let start = 0;
      start < embeddedChunks.length;
      start += INSERT_BATCH_SIZE
    ) {
      const rows: NewChunk[] = embeddedChunks
        .slice(start, start + INSERT_BATCH_SIZE)
        .map((chunk) => ({
          documentId,
          userId,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
          pageNumber: chunk.pageNumber,
          tokenCount: chunk.tokenCount,
          embedding: chunk.embedding,
        }));

      await tx.insert(chunksTable).values(rows);
    }
  });
};

/**
 * Update the document's status to the new status
 * Assume that user's ownership(authentication) is done before this function call
 *
 * @param documentId id of the document to update
 * @param status the new status to be updated
 * @returns the updated document
 * @throws Error for db error
 */
export const updateDocumentStatus = async (
  documentId: string,
  status: DocumentStatus,
): Promise<Document[]> => {
  try {
    return await Sentry.startSpan(
      {
        name: "update-document-status",
        op: "db.query",
        attributes: { "document.status": status },
      },
      async () => {
        return db
          .update(documents)
          .set({ status })
          .where(eq(documents.id, documentId))
          .returning();
      },
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        area: "document-status-update",
      },
    });
    throw new Error("Failed to update the document status");
  }
};

type Props = {
  documentId: string;
  job: Job<DocumentJob, void>;
};

export const processDocument = async ({
  documentId,
  job,
}: Props): Promise<void> => {
  /// DO NOT TOUCH THIS FILE NOW ///
  await updateDocumentStatus(documentId, "processing");

  try {
    const documentResult = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    const document = documentResult[0];

    await job.updateProgress(10);

    // download from r2
    const file = await Sentry.startSpan(
      {
        name: "download-r2",
        op: "storage.download",
      },
      async () => {
        return downloadFromR2(document.r2Key);
      },
    );

    await job.updateProgress(25);

    // extract text
    const text = await Sentry.startSpan(
      {
        name: "extract-text",
        op: "document.extract",
      },
      async () => {
        return extractText(file, document.fileType, {
          hasMathFormula: document.hasMathFormula,
        });
      },
    );

    await job.updateProgress(55);

    // chunking
    const chunks: TextChunk[] = chunkText(text);

    await job.updateProgress(55);

    // embedding
    const embeddedChunks = await Sentry.startSpan(
      {
        name: "embed-chunks",
        op: "ai.embedding",
      },
      async () => {
        return embedChunks(chunks);
      },
    );

    await job.updateProgress(85);

    // store chunks
    await Sentry.startSpan(
      {
        name: "store-chunks",
        op: "db.query",
      },
      async () => {
        return storeChunks(document.id, document.userId, embeddedChunks);
      },
    );

    await updateDocumentStatus(documentId, "ready");

    await job.updateProgress(100);
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        area: "document-ingestion",
      },
    });
    await updateDocumentStatus(documentId, "failed");
    throw error;
  }
};

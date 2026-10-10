import "./src/config/sentry";
import { env } from "./src/config/env";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import * as Sentry from "@sentry/node";

import notebooksRouter from "./src/routes/notebooks.route";
import documentsRouter from "./src/routes/documents.route";
import chatRouter from "./src/routes/chat.route";
import flashcardsRouter from "./src/routes/flashcards.route";
import coursesRouter from "./src/routes/courses.route";
import testsRouter from "./src/routes/tests.route";

const app = express();
const port = 3000;

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.json({ message: "Server is running" });
});

app.use("/api/notebooks", notebooksRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/flashcards", flashcardsRouter);
app.use("/api/tests", testsRouter);
app.use("/api/courses", coursesRouter);

Sentry.setupExpressErrorHandler(app);

app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error(err);

    res.status(500).json({
      error: "Internal server error",
    });
  },
);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

export default app;

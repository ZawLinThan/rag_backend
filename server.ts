import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import documentsRouter from "./src/routes/documents.route"; 
import chatRouter from "./src/routes/chat.route";
import flashcardsRouter from "./src/routes/flashcards.route";

dotenv.config();

const app = express();
const port = 3000;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
)
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.json({ message: "Server is running" });
});

app.use("/api/documents", documentsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/flashcards", flashcardsRouter);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

export default app; 
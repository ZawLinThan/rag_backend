import "dotenv/config";
import express from "express";

const app = express();
const port = 3000;

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Server is running" });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

export default app; 
import { Router } from "express";
import { protectRoute } from "../middleware/protectRoute.js";
import {
  deleteDocument,
  editDocument,
  getAllDocuments,
  getDocumentFile,
  getPresignedUrl,
  getSingleDocument,
  ingestPipeline,
} from "../controllers/documents.controller.js";

const router = Router();

router.post("/presign", protectRoute, getPresignedUrl);
router.post("/confirm", protectRoute, ingestPipeline);
router.get("/", protectRoute, getAllDocuments);
router.get("/:id/file", protectRoute, getDocumentFile);
router.get("/:id", protectRoute, getSingleDocument);
router.delete("/:id", protectRoute, deleteDocument);
router.patch("/:id", protectRoute, editDocument);
router.get("/health", (_req, res) => {
  res.status(200).json({ message: "Documents route is healthy" });
});

export default router;

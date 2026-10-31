import { Router } from "express";
import { protectRoute } from "../middleware/protectRoute.js";
import {
  getAllNotebooks,
  createNotebook,
  editNotebook,
  deleteNotebook,
} from "../controllers/notebooks.controller.js";

const router = Router();

router.use(protectRoute);
router.get("/", getAllNotebooks);
router.post("/", createNotebook);
router.patch("/:id", editNotebook);
router.delete("/:id", deleteNotebook);

export default router;

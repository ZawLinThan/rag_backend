import { Router } from "express";
import { protectRoute } from "../middleware/protectRoute";
import {
  getAllNotebooks,
  createNotebook,
} from "../controllers/notebooks.controller";

const router = Router();

router.use(protectRoute);
router.get("/", getAllNotebooks);
router.post("/", createNotebook);

export default router;

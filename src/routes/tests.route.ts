import { protectRoute } from "../middleware/protectRoute";
import { Router } from "express";
import {
  getTestContent,
  generateTest,
  getAllTests,
  getSingleTestById,
  deleteSingleTest,
} from "../controllers/tests.controller";

const router = Router();

router.use(protectRoute);

router.post("/generate", generateTest);
router.get("/", getAllTests);
router.get("/:id/content", getTestContent);
router.get("/:id", getSingleTestById);
router.delete("/:id", deleteSingleTest);

export default router;

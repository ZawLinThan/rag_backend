import { Router } from "express";
import { protectRoute } from "../middleware/protectRoute.js";
import {
  createFlashcardSet,
  getAllFlashCardsSets,
  generateFlashcards,
  getFlashcardsBySetId,
  addFlashcardToSet,
  updateSingleFlashcard,
  deleteSingleFlashcard,
  deleteFlashcardSet,
} from "../controllers/flashcards.controller.js";

const router = Router();

router.post("/", protectRoute, createFlashcardSet);
router.get("/", protectRoute, getAllFlashCardsSets);
router.post("/generate", protectRoute, generateFlashcards);
router.get("/:setId", protectRoute, getFlashcardsBySetId);
router.post("/:setId/cards", protectRoute, addFlashcardToSet);
router.patch("/:setId/cards/:cardId", protectRoute, updateSingleFlashcard);
router.delete("/:setId/cards/:cardId", protectRoute, deleteSingleFlashcard);
router.delete("/:setId", protectRoute, deleteFlashcardSet);
// add a route to store user's answers to flashcards and return nex time for weaknesses
router.get("/health", (_req, res) => {
  res.status(200).json({ message: "Flashcards route is healthy" });
});

export default router;

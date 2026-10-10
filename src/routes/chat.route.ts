import { Router } from "express";
import { protectRoute } from "../middleware/protectRoute.js";
import {
  createNewChatSession,
  deleteChatSession,
  getAllChatSessions,
  getSingleChatSession,
} from "../controllers/chat.controller.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.status(200).json({ message: "Chat route is healthy" });
});

router.post("/sessions", protectRoute, createNewChatSession);
router.get("/sessions", protectRoute, getAllChatSessions);
router.get("/sessions/:id", protectRoute, getSingleChatSession);
router.delete("/sessions/:id", protectRoute, deleteChatSession);

export default router;

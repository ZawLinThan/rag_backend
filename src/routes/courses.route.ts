import { protectRoute } from "../middleware/protectRoute.js";
import { Router } from "express";
import {
  getAllCourses,
  createCourse,
  getCourseById,
  deleteCourse,
} from "../controllers/courses.controller.js";

const router = Router();

router.use(protectRoute);

router.get("/", getAllCourses);
router.post("/", createCourse);
router.get("/:id", getCourseById);
router.delete("/:id", deleteCourse);

export default router;

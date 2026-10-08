import { Router } from "express";
import {generateTest, getAllTests, getSingleTestById, deleteSingleTest} from '../controllers/tests.controller'; 

const router =  Router(); 

router.post("/generate", generateTest); 
router.get("/", getAllTests); 
router.get("/:id", getSingleTestById); 
router.delete("/:id", deleteSingleTest); 

export default router; 
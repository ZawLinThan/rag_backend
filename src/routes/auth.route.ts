// The client you created from the Server-Side Auth instructions

import Router from "express"; 
import { confirmAuth } from "../controllers/auth.controller";

const router = Router(); 

router.get("/auth/confirm", confirmAuth)
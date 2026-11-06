import { embedText } from "./config/openRouterAI.js";
import { embedQuestion } from "./services/retrieval.service.js";

console.log(await embedQuestion("Embed this text", embedText));

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleGradeAnswer } from "./handler.ts";

serve((req: Request) => handleGradeAnswer(req));

// Features a scripted job never needs. Each one adds tool schemas or instructions to every model call.
import path from 'node:path';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
export const LEAN_CODEX=['--disable','multi_agent','--disable','goals','--disable','image_generation','--disable','view_image','--disable','sleep_tool','--disable','skill_search','--disable','tool_suggest','--disable','collaboration_modes','-c',`model_instructions_file="${path.join(dir,'codex-instructions.md')}"`];

/**
 * Composition root for the Workboard extension.
 *
 * Pi loads this module and calls the default export with the extension API.
 * The extension stores its data under `<cwd>/.pi/workboard`.
 */

import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWorkboardEnvironment } from "./services/workboard.js";
import { registerTools } from "./pi/register-tools.js";
import { registerCommands } from "./pi/register-commands.js";
import { registerLifecycle } from "./pi/register-lifecycle.js";

export default async function workboardExtension(pi: ExtensionAPI): Promise<void> {
  const dir = path.join(process.cwd(), ".pi", "workboard");
  const env = await createWorkboardEnvironment(dir);
  const ctx = {
    ticketService: env.ticketService,
    lifecycle: env.lifecycle,
    selection: env.selection,
    sessionActive: env.sessionActive,
    boardRepo: env.boardRepo,
  };
  registerTools(pi, ctx);
  registerCommands(pi, ctx);
  registerLifecycle(pi, ctx);
}

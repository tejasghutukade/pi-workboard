/**
 * Pi lifecycle registration (Milestone 5): durable context restoration.
 *
 * - `session_start`: validate board metadata, verify the active ticket is an
 *   existing `in_progress` ticket, report inconsistencies WITHOUT changing
 *   files, and show the status widget.
 * - `context` / `before_agent_start`: generate a context block summarizing the
 *   active ticket and inject it before the agent begins a task (stripping stale
 *   copies first so the block is never duplicated).
 *
 * Note: `AgentMessage` / `ContextEventResult` / `CustomMessage` are not part of
 * the package's public type surface in this Pi version, so the `on` binding is
 * typed permissively. The handler bodies use only the documented runtime shape.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WorkboardContext } from "./register-tools.js";
import { updateStatusWidget } from "./status-widget.js";
import { generateContextBlock } from "./context-block.js";

const CONTEXT_CUSTOM_TYPE = "workboard-context";

type AnyHandler = (event: any, ctx: any) => any;

export function registerLifecycle(pi: ExtensionAPI, ctx: WorkboardContext): void {
  const on = pi.on.bind(pi) as (event: string, handler: AnyHandler) => void;

  on("session_start", async (_event, c) => {
    const validation = await ctx.lifecycle.validateActiveTicket();
    if (!validation.valid) {
      c.ui.notify(
        `Workboard consistency issues (files left untouched):\n${validation.issues.join("\n")}`,
        "warning",
      );
    }
    await updateStatusWidget(c, ctx, c.sessionManager.getSessionId());
  });

  // Keep the status widget live: the agent mutates the board through the
  // workboard_* tools, and those tools don't refresh the widget themselves.
  // Refresh after every workboard tool so this session's active ticket updates
  // without requiring a /reload. Commands also refresh via updateStatusWidget.
  on("tool_execution_end", async (event, c) => {
    if (typeof event?.toolName === "string" && event.toolName.startsWith("workboard_")) {
      await updateStatusWidget(c, ctx, c.sessionManager.getSessionId());
    }
  });

  // Strip our previously-injected block before context is rebuilt so it is not
  // accumulated across compactions; before_agent_start re-injects it fresh.
  on("context", (event) => {
    const messages = (event.messages as Array<{ customType?: string }>).filter(
      (m) => m.customType !== CONTEXT_CUSTOM_TYPE,
    );
    return { messages };
  });

  // Inject the active-ticket context before each agent task. display:false
  // keeps it in the agent's context without rendering the block in the UI
  // (a truthy string like "system" would render it on every turn — noisy).
  on("before_agent_start", async (_event, c) => {
    const block = await generateContextBlock(ctx, c.sessionManager.getSessionId());
    return {
      message: {
        customType: CONTEXT_CUSTOM_TYPE,
        content: block,
        display: false,
        details: { type: CONTEXT_CUSTOM_TYPE },
      },
    };
  });
}

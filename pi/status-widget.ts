/**
 * Small status widget shown in the TUI: this session's active ticket (set when
 * a session runs /ticket-work or workboard_start), or the global in_progress
 * set when nothing is pinned for the session. Shared by the commands and the
 * session_start lifecycle handler so it has a single source of truth.
 */

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { WorkboardContext } from "./register-tools.js";

export const STATUS_WIDGET = "workboard-status";

export async function updateStatusWidget(
  ctx: { ui: ExtensionUIContext },
  services: WorkboardContext,
  sessionId?: string,
): Promise<void> {
  ctx.ui.setWidget(STATUS_WIDGET, await statusLines(services, sessionId));
}

export async function statusLines(
  services: WorkboardContext,
  sessionId?: string,
): Promise<string[]> {
  // Prefer this session's pinned active ticket.
  const sessionTicketId = sessionId ? await services.sessionActive.get(sessionId) : undefined;
  if (sessionTicketId) {
    const t = await services.ticketService.get(sessionTicketId).catch(() => undefined);
    if (t && (t.status === "in_progress" || t.status === "in_review")) {
      const label =
        t.status === "in_review" ? "In review (this session)" : "Active (this session)";
      return [
        `${label}: ${t.id} [${t.priority}]${t.worktree ? ` → ${t.worktree}` : ""}`,
        "Use /ticket WB-0001 to view it.",
      ];
    }
  }

  const all = await services.ticketService.list();
  const active = all.filter((t) => t.status === "in_progress");
  if (active.length > 0) {
    const ids = active
      .map((t) =>
        t.worktree
          ? `${t.id} [${t.priority}] → ${t.worktree}`
          : `${t.id} [${t.priority}]`,
      )
      .join(", ");
    return [
      `Active (${active.length}): ${ids}`,
      "Use /ticket WB-0001 to view one.",
    ];
  }
  const ready = all.filter((t) => t.status === "ready").length;
  const blocked = all.filter((t) => t.status === "blocked").length;
  return [`No active ticket.`, `Ready: ${ready}   Blocked: ${blocked}`];
}

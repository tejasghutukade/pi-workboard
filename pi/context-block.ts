/**
 * Pre-agent context generation (Milestone 5). Builds a compact block that
 * summarizes the active ticket(s) and recent progress so the agent starts a
 * task with the durable source of truth in view. Injected before the agent
 * begins via the `before_agent_start` event (the version-appropriate
 * replacement for the blueprint's `pi.pushContext`).
 *
 * Parallel work is allowed, so there may be more than one active (in_progress)
 * ticket; the block lists them all.
 */

import type { WorkboardContext } from "./register-tools.js";

export async function generateContextBlock(
  ctx: WorkboardContext,
  sessionId?: string,
): Promise<string> {
  // Prefer this session's pinned active ticket.
  const sessionTicketId = sessionId ? await ctx.sessionActive.get(sessionId) : undefined;
  if (sessionTicketId) {
    const t = await ctx.ticketService.get(sessionTicketId).catch(() => undefined);
    if (t && (t.status === "in_progress" || t.status === "in_review")) {
      const remaining = t.acceptanceCriteria.filter((c) => !c.completed);
      const lines = [`Active ticket ${t.id} [${t.priority}] ${t.status}: ${t.title}`];
      if (t.objective) lines.push(`  Objective: ${t.objective}`);
      lines.push(`  Scope: ${t.scope.join("; ") || "(none)"}`);
      if (t.prerequisites?.length)
        lines.push(`  Prerequisites: ${t.prerequisites.join("; ")}`);
      lines.push(
        `  Remaining acceptance criteria: ${remaining.map((c) => c.id).join(", ") || "none"}`,
      );
      if (t.blockedReason) lines.push(`  Blocked: ${t.blockedReason}`);
      if (t.worktree) lines.push(`  Worktree: ${t.worktree} (work here)`);
      const recent = (t.progress ?? []).slice(-5);
      if (recent.length > 0) {
        lines.push("  Recent progress:");
        for (const p of recent) lines.push(`    - [${p.type}] ${p.content}`);
      }
      return `Active ticket (this session):\n${lines.join("\n")}`;
  }
  }

  const active = await ctx.lifecycle.getActive();
  if (active.length > 0) {
    const blocks = active.map((t) => {
      const remaining = t.acceptanceCriteria.filter((c) => !c.completed);
      const lines = [`Active ticket ${t.id} [${t.priority}] ${t.status}: ${t.title}`];
      if (t.objective) lines.push(`  Objective: ${t.objective}`);
      lines.push(`  Scope: ${t.scope.join("; ") || "(none)"}`);
      if (t.prerequisites?.length)
        lines.push(`  Prerequisites: ${t.prerequisites.join("; ")}`);
      lines.push(
        `  Remaining acceptance criteria: ${remaining.map((c) => c.id).join(", ") || "none"}`,
      );
      if (t.blockedReason) lines.push(`  Blocked: ${t.blockedReason}`);
      if (t.worktree) lines.push(`  Worktree: ${t.worktree} (work here)`);
      const recent = (t.progress ?? []).slice(-5);
      if (recent.length > 0) {
        lines.push("  Recent progress:");
        for (const p of recent) lines.push(`    - [${p.type}] ${p.content}`);
      }
      return lines.join("\n");
    });
    return `Active tickets (${active.length}):\n${blocks.join("\n\n")}`;
  }

  const all = await ctx.ticketService.list();
  const ready = all.filter((t) => t.status === "ready").length;
  const blocked = all.filter((t) => t.status === "blocked").length;
  return `No active ticket. Ready: ${ready}, Blocked: ${blocked}. Use workboard_next or /ticket-next to pick one.`;
}

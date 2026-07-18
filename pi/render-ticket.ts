/**
 * Human-readable ticket rendering (used by the `workboard_get` tool and the
 * `/ticket` command). Returns an array of lines for TUI widgets.
 */

import type { WorkTicket } from "../domain/ticket.js";

export function renderTicket(t: WorkTicket): string[] {
  const lines: string[] = [`${t.id} [${t.priority}] ${t.status}`];
  if (t.title) lines.push(`Title: ${t.title}`);
  if (t.objective) lines.push(`Objective: ${t.objective}`);
  if (t.prerequisites?.length)
    lines.push(`Prerequisites:` + t.prerequisites.map((s) => `\n  - ${s}`).join(""));
  if (t.background) lines.push(`Background: ${t.background}`);
  if (t.scope.length) lines.push(`Scope:` + t.scope.map((s) => `\n  - ${s}`).join(""));
  if (t.outOfScope.length)
    lines.push(`Out of scope:` + t.outOfScope.map((s) => `\n  - ${s}`).join(""));
  if (t.acceptanceCriteria.length) {
    lines.push("Acceptance criteria:");
    for (const c of t.acceptanceCriteria) {
      lines.push(
        `  - [${c.completed ? "x" : " "}] ${c.id}: ${c.description}` +
          (c.evidence ? ` (evidence: ${c.evidence})` : ""),
      );
    }
  }
  if (t.constraints.length) lines.push(`Constraints: ${t.constraints.join("; ")}`);
  if (t.decisions.length) lines.push(`Decisions: ${t.decisions.join("; ")}`);
  if (t.references.length) lines.push(`References: ${t.references.join("; ")}`);
  if (t.affectedAreas.length) lines.push(`Affected areas: ${t.affectedAreas.join("; ")}`);
  if (t.dependencies.length)
    lines.push(
      `Dependencies: ${t.dependencies.map((d) => `${d.type} ${d.ticketId}`).join(", ")}`,
    );
  if (t.blockedReason) lines.push(`Blocked reason: ${t.blockedReason}`);
  if (t.worktree) lines.push(`Worktree: ${t.worktree}`);
  if (t.verificationSummary) lines.push(`Verification summary: ${t.verificationSummary}`);
  return lines;
}

/** One-line summary used in board listings and list output. */
export function ticketSummary(t: WorkTicket): string {
  const deps = t.dependencies
    .map((d) => (d.type === "blocked_by" ? `⛔${d.ticketId}` : `→${d.ticketId}`))
    .join(" ");
  return `${t.id} [${t.priority}] ${t.status}  ${t.title}${deps ? `  ${deps}` : ""}`;
}

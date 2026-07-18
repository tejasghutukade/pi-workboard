/**
 * Compact Jira-style board rendering for the `/board` command.
 * Grouped into Ready, In Progress, Blocked, and Done. Done is limited to the
 * five most recent completed tickets.
 */

import type { WorkTicket } from "../domain/ticket.js";
import { ticketSummary } from "./render-ticket.js";

/** How many Done tickets to show before collapsing the rest into a count. */
const MAX_DONE_VISIBLE = 5;

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

type Group = "ready" | "in_progress" | "in_review" | "blocked" | "done";

export function renderBoard(tickets: WorkTicket[]): string[] {
  const groups: Record<Group, WorkTicket[]> = {
    ready: [],
    in_progress: [],
    in_review: [],
    blocked: [],
    done: [],
  };
  for (const t of tickets) {
    if (t.status in groups) groups[t.status as Group].push(t);
  }

  // Ready: highest priority first, then oldest first.
  groups.ready.sort(byPriorityThenOldest);
  // In progress / review / blocked: keep stable-ish by priority then created.
  groups.in_progress.sort(byPriorityThenOldest);
  groups.in_review.sort(byPriorityThenOldest);
  groups.blocked.sort(byPriorityThenOldest);
  // Done: newest completed first (so the most recently finished ticket is on
  // top), then cap the visible count so the section never grows too long.
  // Fall back to updatedAt/createdAt when completedAt is absent (older data).
  groups.done.sort((a, b) => completedKey(b).localeCompare(completedKey(a)));
  const doneTotal = groups.done.length;
  const doneVisible = groups.done.slice(0, MAX_DONE_VISIBLE);

  const lines: string[] = ["Workboard"];
  lines.push(...section("Ready", groups.ready));
  lines.push(...section("In Progress", groups.in_progress));
  lines.push(...section("In Review", groups.in_review));
  lines.push(...section("Blocked", groups.blocked));
  lines.push(...section(
    `Done (showing ${doneVisible.length} of ${doneTotal})`,
    doneVisible,
  ));
  return lines;
}

/** A sortable timestamp for "when was this ticket done", with sensible fallbacks. */
function completedKey(t: WorkTicket): string {
  return t.completedAt ?? t.updatedAt ?? t.createdAt;
}

function section(title: string, items: WorkTicket[]): string[] {
  const out = [`\n## ${title} (${items.length})`];
  if (items.length === 0) out.push("  (none)");
  for (const t of items) out.push(`  ${ticketSummary(t)}`);
  return out;
}

function byPriorityThenOldest(a: WorkTicket, b: WorkTicket): number {
  const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (p !== 0) return p;
  return a.createdAt.localeCompare(b.createdAt);
}

/**
 * Ticket lifecycle: the set of statuses and the pure transition rules between
 * them. Enforcement (with domain errors) lives in the lifecycle service
 * (Milestone 2); this module is only the declarative, testable rule set.
 *
 * Allowed transitions (blueprint section 5):
 *
 *   backlog -> ready -> in_progress -> in_review -> done
 *                        |              ^
 *                        v              |
 *                     blocked -> ready   +-- request changes
 *
 *   backlog | ready | blocked -> cancelled
 */

import type { TicketStatus } from "./ticket.js";

export const TICKET_STATUSES: readonly TicketStatus[] = [
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
];

export const ALLOWED_TRANSITIONS: Record<
  TicketStatus,
  readonly TicketStatus[]
> = {
  backlog: ["ready", "cancelled"],
  ready: ["in_progress", "cancelled"],
  in_progress: ["blocked", "in_review", "cancelled"],
  in_review: ["in_progress", "done", "cancelled"],
  blocked: ["ready", "cancelled"],
  done: [],
  cancelled: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: TicketStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

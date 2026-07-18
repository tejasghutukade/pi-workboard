/**
 * Selection service: implements `workboard_next`.
 *
 *   1. Return the active (in_progress) ticket if one exists.
 *   2. Otherwise consider only `ready` tickets.
 *   3. Exclude those with unresolved `blocked_by` dependencies.
 *   4. Sort by priority (critical first).
 *   5. For equal priority, pick the oldest ticket (then by id).
 */

import type { Priority, WorkTicket } from "../domain/ticket.js";
import type { TicketRepository } from "../storage/ticket-repository.js";
import type { DependencyService } from "./dependency-service.js";

const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export class SelectionService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly deps: DependencyService,
  ) {}

  async next(): Promise<WorkTicket | null> {
    const all = await this.tickets.list();

    // Parallel work is allowed, so "next" means the best ticket to START: a
    // `ready` ticket with no unresolved blockers. Already-active (in_progress)
    // tickets are skipped — they are being worked on, not "next to pick up".
    const ready = all.filter((t) => t.status === "ready");
    const selectable: WorkTicket[] = [];
    for (const ticket of ready) {
      const unresolved = await this.deps.findUnresolvedBlockers(ticket);
      if (unresolved.length === 0) selectable.push(ticket);
    }
    if (selectable.length === 0) return null;

    selectable.sort((a, b) => {
      const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (byPriority !== 0) return byPriority;
      if (a.createdAt !== b.createdAt) {
        return a.createdAt < b.createdAt ? -1 : 1;
      }
      return a.id.localeCompare(b.id);
    });

    return selectable[0];
  }
}

/**
 * Dependency rules: self-dependency rejection, cycle detection (direct and
 * transitive), and resolution of `blocked_by` blockers.
 *
 * These are pure structural checks plus one read of the ticket store to resolve
 * blocker status. They are used by the lifecycle and selection services.
 */

import type { TicketDependency, WorkTicket } from "../domain/ticket.js";
import type { TicketRepository } from "../storage/ticket-repository.js";
import { UnresolvedDependencyError } from "../domain/errors.js";

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

export class DependencyService {
  constructor(private readonly tickets: TicketRepository) {}

  /** Ids this ticket depends on via `blocked_by`. */
  blockingIds(ticket: WorkTicket): string[] {
    return ticket.dependencies
      .filter((d) => d.type === "blocked_by")
      .map((d) => d.ticketId);
  }

  /** Throw if a ticket lists itself as a dependency. */
  assertNoSelfDependency(ticketId: string, deps: TicketDependency[]): void {
    const self = deps.some((d) => d.ticketId === ticketId);
    if (self) {
      throw new UnresolvedDependencyError(
        [ticketId],
        "A ticket cannot depend on itself.",
      );
    }
  }

  /**
   * Detect a dependency cycle (direct or transitive) across the given tickets
   * and throw if one exists. All dependency types participate in cycle
   * detection because a loop can never be resolved.
   */
  assertNoCycles(all: WorkTicket[]): void {
    const byId = new Map(all.map((t) => [t.id, t]));
    const color = new Map<string, number>();
    const stack: string[] = [];

    const visit = (id: string): void => {
      color.set(id, GRAY);
      stack.push(id);
      const ticket = byId.get(id);
      if (ticket) {
        for (const dep of ticket.dependencies) {
          const state = color.get(dep.ticketId) ?? WHITE;
          if (state === GRAY) {
            const start = stack.indexOf(dep.ticketId);
            const cycle = stack.slice(start).concat(dep.ticketId);
            throw new UnresolvedDependencyError(
              cycle,
              `Circular dependency detected: ${cycle.join(" -> ")}.`,
            );
          }
          if (state === WHITE) visit(dep.ticketId);
        }
      }
      stack.pop();
      color.set(id, BLACK);
    };

    for (const ticket of all) {
      if ((color.get(ticket.id) ?? WHITE) === WHITE) visit(ticket.id);
    }
  }

  /**
   * Return the ids of `blocked_by` dependencies whose target ticket is not
   * `done` (or is missing entirely). An empty result means the ticket is
   * unblocked.
   */
  async findUnresolvedBlockers(ticket: WorkTicket): Promise<string[]> {
    const all = await this.tickets.list();
    const byId = new Map(all.map((t) => [t.id, t]));
    const unresolved: string[] = [];
    for (const dep of ticket.dependencies) {
      if (dep.type !== "blocked_by") continue;
      const target = byId.get(dep.ticketId);
      if (!target || target.status !== "done") unresolved.push(dep.ticketId);
    }
    return unresolved;
  }
}

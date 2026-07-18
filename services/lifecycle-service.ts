/**
 * Lifecycle service: the §5 state transitions and their invariants.
 *
 *   backlog -> ready -> in_progress -> done
 *                        |
 *                        v
 *                     blocked -> ready
 *
 *   backlog | ready | blocked -> cancelled
 *
 * Every transition uses a dedicated operation (never a generic field update),
 * enforces the blueprint's invariants, and records a `status_change` progress
 * note. Parallel work is allowed: any number of tickets may be `in_progress`
 * at once (the "active" set is derived from ticket status). The only gate on
 * starting a ticket is that it has no unresolved blockers (ticket or external
 * dependency) — blocked tickets cannot be started because `start` requires the
 * `ready` status.
 */

import type { Clock, WorkTicket } from "../domain/ticket.js";
import { getMissingRefinementFields } from "../domain/ticket.js";
import {
  AcceptanceCriteriaIncompleteError,
  IncompleteTicketError,
  InvalidTransitionError,
  TicketNotFoundError,
  UnresolvedDependencyError,
} from "../domain/errors.js";
import type { TicketRepository } from "../storage/ticket-repository.js";
import type { DependencyService } from "./dependency-service.js";
import type { TicketService } from "./ticket-service.js";

export class LifecycleService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly clock: Clock,
    private readonly deps: DependencyService,
    private readonly ticketService: TicketService,
  ) {}

  private async require(id: string, expected?: WorkTicket["status"]): Promise<WorkTicket> {
    const ticket = await this.tickets.get(id);
    if (!ticket) throw new TicketNotFoundError(id);
    if (expected && ticket.status !== expected) {
      throw new InvalidTransitionError(ticket.status, expected);
    }
    return ticket;
  }

  /** backlog -> ready (only when refinement is complete). */
  async markReady(id: string): Promise<WorkTicket> {
    const ticket = await this.require(id, "backlog");
    const missing = getMissingRefinementFields(ticket);
    if (missing.length > 0) throw new IncompleteTicketError(missing);
    ticket.status = "ready";
    ticket.updatedAt = this.clock.now();
    await this.tickets.update(ticket);
    return await this.ticketService.recordProgress(id, "status_change", "Marked ready.");
  }

  /** ready -> in_progress.
   *
   * Parallel work is allowed, so any number of tickets may be `in_progress` at
   * once. The only gate is that the ticket must have no unresolved blockers
   * (ticket OR external dependency). Blocked tickets are prevented because
   * `start` requires the `ready` status. */
  async start(id: string): Promise<WorkTicket> {
    const ticket = await this.require(id, "ready");
    const unresolved = await this.deps.findUnresolvedBlockers(ticket);
    if (unresolved.length > 0) throw new UnresolvedDependencyError(unresolved);

    ticket.status = "in_progress";
    ticket.startedAt = this.clock.now();
    ticket.updatedAt = this.clock.now();
    await this.tickets.update(ticket);

    return await this.ticketService.recordProgress(id, "status_change", "Started.");
  }

  /**
   * in_progress -> blocked. Requires a reason and (optionally) records a
   * `blocked_by` dependency on the responsible ticket. Clears the active slot.
   */
  async block(
    id: string,
    reason: string,
    blockedByTicketId?: string,
  ): Promise<WorkTicket> {
    const ticket = await this.require(id, "in_progress");
    if (!reason || reason.trim().length === 0) {
      throw new InvalidTransitionError(
        "in_progress",
        "blocked",
        "A blocked reason is required.",
      );
    }

    if (blockedByTicketId) {
      if (blockedByTicketId === id) {
        throw new UnresolvedDependencyError(
          [id],
          "A ticket cannot block itself.",
        );
      }
      const target = await this.tickets.get(blockedByTicketId);
      if (!target) throw new TicketNotFoundError(blockedByTicketId);

      const all = await this.tickets.list();
      const updatedDeps = [
        ...ticket.dependencies.filter((d) => d.ticketId !== blockedByTicketId),
        { ticketId: blockedByTicketId, type: "blocked_by" as const },
      ];
      this.deps.assertNoCycles(
        all.filter((t) => t.id !== id).concat({ ...ticket, dependencies: updatedDeps }),
      );
      ticket.dependencies = updatedDeps;
    }

    ticket.status = "blocked";
    ticket.blockedReason = reason;
    ticket.updatedAt = this.clock.now();
    await this.tickets.update(ticket);

    return await this.ticketService.recordProgress(id, "blocker", `Blocked: ${reason}`);
  }

  /** blocked -> ready (only when the blocked reason is cleared and every
   * `blocked_by` dependency is done or removed). Does not auto-start. */
  async unblock(id: string): Promise<WorkTicket> {
    const ticket = await this.require(id, "blocked");
    const unresolved = await this.deps.findUnresolvedBlockers(ticket);
    if (unresolved.length > 0) {
      throw new UnresolvedDependencyError(
        unresolved,
        "Resolve or remove blocked_by dependencies before unblocking.",
      );
    }
    ticket.status = "ready";
    ticket.blockedReason = undefined;
    ticket.updatedAt = this.clock.now();
    await this.tickets.update(ticket);
    return await this.ticketService.recordProgress(id, "status_change", "Unblocked.");
  }

  /** in_progress -> in_review. Moves the implemented ticket into review.
   * Requires every acceptance criterion to be marked complete (implementation
   * done) so review is not opened on unfinished work. Evidence is not required
   * at this stage — that gate belongs to `complete`. */
  async submitForReview(id: string): Promise<WorkTicket> {
    const ticket = await this.require(id, "in_progress");
    const incomplete = ticket.acceptanceCriteria
      .filter((c) => !c.completed)
      .map((c) => c.id);
    if (incomplete.length > 0) {
      throw new AcceptanceCriteriaIncompleteError(incomplete);
    }
    ticket.status = "in_review";
    ticket.updatedAt = this.clock.now();
    await this.tickets.update(ticket);
    return await this.ticketService.recordProgress(
      id,
      "status_change",
      "Submitted for review.",
    );
  }

  /** in_review -> in_progress. Returns a ticket to implementation when review
   * requests changes. */
  async requestChanges(id: string): Promise<WorkTicket> {
    const ticket = await this.require(id, "in_review");
    ticket.status = "in_progress";
    ticket.updatedAt = this.clock.now();
    await this.tickets.update(ticket);
    return await this.ticketService.recordProgress(
      id,
      "status_change",
      "Changes requested; back to in_progress.",
    );
  }

  /** in_review -> done (all criteria verified, verification summary present).
   *
   * Review is a required gate: a ticket may only be completed from `in_review`,
   * never directly from `in_progress`. Use `submitForReview` first. */
  async complete(id: string, verificationSummary: string): Promise<WorkTicket> {
    const ticket = await this.require(id, "in_review");
    const incomplete = ticket.acceptanceCriteria
      .filter((c) => !c.completed || !c.evidence || c.evidence.trim().length === 0)
      .map((c) => c.id);
    if (incomplete.length > 0) {
      throw new AcceptanceCriteriaIncompleteError(incomplete);
    }
    if (!verificationSummary || verificationSummary.trim().length === 0) {
      throw new InvalidTransitionError(
        "in_progress",
        "done",
        "A verification summary is required to complete the ticket.",
      );
    }
    ticket.status = "done";
    ticket.verificationSummary = verificationSummary;
    ticket.completedAt = this.clock.now();
    ticket.updatedAt = this.clock.now();
    await this.tickets.update(ticket);

    return await this.ticketService.recordProgress(
      id,
      "verification",
      `Completed: ${verificationSummary}`,
    );
  }

  /** backlog | ready | blocked -> cancelled (terminal; no reopening in MVP). */
  async cancel(id: string): Promise<WorkTicket> {
    const ticket = await this.require(id);
    if (ticket.status === "done" || ticket.status === "cancelled") {
      throw new InvalidTransitionError(ticket.status, "cancelled");
    }
    ticket.status = "cancelled";
    ticket.updatedAt = this.clock.now();
    await this.tickets.update(ticket);

    return await this.ticketService.recordProgress(id, "status_change", "Cancelled.");
  }

  /** Return all currently active (in_progress) tickets, or an empty array. */
  async getActive(): Promise<WorkTicket[]> {
    return (await this.tickets.list()).filter((t) => t.status === "in_progress");
  }

  /**
   * Validate the active (in_progress) set. Because multiple tickets may be
   * in_progress at once, this checks for drift rather than a single pointer:
   * every in_progress ticket must have its dependencies satisfied. Reports
   * issues without modifying anything (used by the session_start handler).
   */
  async validateActiveTicket(): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    const inProgress = (await this.tickets.list()).filter((t) => t.status === "in_progress");
    for (const ticket of inProgress) {
      const unresolved = await this.deps.findUnresolvedBlockers(ticket);
      if (unresolved.length > 0) {
        issues.push(
          `ticket ${ticket.id} is in_progress but has unresolved blockers: ${unresolved.join(", ")}`,
        );
      }
      if (ticket.blockedReason) {
        issues.push(
          `ticket ${ticket.id} is in_progress but still has a blocked reason: ${ticket.blockedReason}`,
        );
      }
    }
    return { valid: issues.length === 0, issues };
  }
}

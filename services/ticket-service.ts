/**
 * Ticket service: creation/refinement, reads, partial updates, progress notes,
 * and acceptance-criterion handling.
 *
 * This service owns everything that mutates a single ticket's *content* (not
 * its lifecycle status, which lives in the lifecycle service). Status is never
 * changed here; `update` refuses to touch status, acceptance completion, or
 * progress history.
 */

import type {
  AcceptanceCriterion,
  Clock,
  ProgressEntry,
  ProgressType,
  TicketDependency,
  WorkTicket,
} from "../domain/ticket.js";
import { getMissingRefinementFields } from "../domain/ticket.js";
import {
  AcceptanceCriteriaIncompleteError,
  CriterionNotFoundError,
  TicketNotFoundError,
} from "../domain/errors.js";
import type { TicketRepository } from "../storage/ticket-repository.js";
import type { IdGenerator } from "../domain/board.js";
import type { DependencyService } from "./dependency-service.js";

export interface CreateTicketInput {
  status?: "backlog" | "ready";
  title?: string;
  objective?: string;
  background?: string;
  scope?: string[];
  outOfScope?: string[];
  acceptanceCriteria?: AcceptanceCriterion[];
  priority?: WorkTicket["priority"];
  constraints?: string[];
  decisions?: string[];
  references?: string[];
  affectedAreas?: string[];
  dependencies?: TicketDependency[];
  prerequisites?: string[];
}

export interface CreateTicketResult {
  id: string;
  status: WorkTicket["status"];
  missing: string[];
}

export interface UpdateTicketInput {
  title?: string;
  objective?: string;
  background?: string;
  scope?: string[];
  outOfScope?: string[];
  constraints?: string[];
  decisions?: string[];
  references?: string[];
  affectedAreas?: string[];
  dependencies?: TicketDependency[];
  prerequisites?: string[];
  worktree?: string;
}

export interface ListFilter {
  status?: WorkTicket["status"];
  priority?: WorkTicket["priority"];
  dependency?: string;
  text?: string;
}

export class TicketService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly deps: DependencyService,
  ) {}

  async create(input: CreateTicketInput): Promise<CreateTicketResult> {
    const id = await this.idGenerator.nextId();
    const now = this.clock.now();
    const ticket = this.buildTicket(id, input, now);
    const missing = getMissingRefinementFields(ticket);

    if (input.dependencies && input.dependencies.length > 0) {
      this.deps.assertNoSelfDependency(id, input.dependencies);
      const all = await this.tickets.list();
      this.deps.assertNoCycles([...all, ticket]);
    }

    // A ticket may only be created as `ready` when refinement is complete.
    if (ticket.status === "ready" && missing.length > 0) {
      ticket.status = "backlog";
    }

    await this.tickets.create(ticket);
    return { id, status: ticket.status, missing };
  }

  async get(id: string): Promise<WorkTicket> {
    const ticket = await this.tickets.get(id);
    if (!ticket) throw new TicketNotFoundError(id);
    return ticket;
  }

  async list(filter?: ListFilter): Promise<WorkTicket[]> {
    let all = await this.tickets.list();
    if (filter?.status) all = all.filter((t) => t.status === filter.status);
    if (filter?.priority) all = all.filter((t) => t.priority === filter.priority);
    if (filter?.dependency) {
      all = all.filter((t) =>
        t.dependencies.some((d) => d.ticketId === filter.dependency),
      );
    }
    if (filter?.text) {
      const q = filter.text.toLowerCase();
      all = all.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.objective.toLowerCase().includes(q),
      );
    }
    return all;
  }

  /**
   * Apply a partial update. Only explicitly supplied fields change. Status,
   * acceptance completion, and progress history are never touched.
   */
  async update(id: string, patch: UpdateTicketInput): Promise<WorkTicket> {
    const ticket = await this.get(id);

    if (patch.title !== undefined) ticket.title = patch.title;
    if (patch.objective !== undefined) ticket.objective = patch.objective;
    if (patch.background !== undefined) ticket.background = patch.background;
    if (patch.scope !== undefined) ticket.scope = patch.scope;
    if (patch.outOfScope !== undefined) ticket.outOfScope = patch.outOfScope;
    if (patch.constraints !== undefined) ticket.constraints = patch.constraints;
    if (patch.decisions !== undefined) ticket.decisions = patch.decisions;
    if (patch.references !== undefined) ticket.references = patch.references;
    if (patch.affectedAreas !== undefined)
      ticket.affectedAreas = patch.affectedAreas;

    if (patch.dependencies !== undefined) {
      this.deps.assertNoSelfDependency(id, patch.dependencies);
      const all = await this.tickets.list();
      const withNewDeps: WorkTicket = { ...ticket, dependencies: patch.dependencies };
      this.deps.assertNoCycles(
        all.filter((t) => t.id !== id).concat(withNewDeps),
      );
      ticket.dependencies = patch.dependencies;
    }

    if (patch.prerequisites !== undefined) {
      ticket.prerequisites = patch.prerequisites;
    }

    if (patch.worktree !== undefined) {
      ticket.worktree = patch.worktree;
    }

    ticket.updatedAt = this.clock.now();
    await this.tickets.update(ticket);
    return ticket;
  }

  /** Append a timestamped progress entry. */
  async recordProgress(
    id: string,
    type: ProgressType,
    content: string,
    author?: string,
  ): Promise<WorkTicket> {
    const ticket = await this.get(id);
    const entry: ProgressEntry = {
      id: `PE-${ticket.progress.length + 1}`,
      timestamp: this.clock.now(),
      type,
      content,
      author,
    };
    ticket.progress.push(entry);
    ticket.updatedAt = this.clock.now();
    await this.tickets.update(ticket);
    return ticket;
  }

  /**
   * Mark one acceptance criterion complete or incomplete.
   * Completing requires evidence; incomplete clears any evidence.
   */
  async setAcceptance(
    id: string,
    criterionId: string,
    completed: boolean,
    evidence?: string,
  ): Promise<WorkTicket> {
    const ticket = await this.get(id);
    const criterion = ticket.acceptanceCriteria.find((c) => c.id === criterionId);
    if (!criterion) throw new CriterionNotFoundError(id, criterionId);

    if (completed) {
      if (!evidence || evidence.trim().length === 0) {
        throw new AcceptanceCriteriaIncompleteError([criterionId]);
      }
      criterion.completed = true;
      criterion.evidence = evidence;
    } else {
      criterion.completed = false;
      criterion.evidence = undefined;
    }

    ticket.updatedAt = this.clock.now();
    await this.tickets.update(ticket);
    return ticket;
  }

  private buildTicket(
    id: string,
    input: CreateTicketInput,
    now: string,
  ): WorkTicket {
    return {
      schemaVersion: 1,
      id,
      title: input.title ?? "",
      status: input.status === "ready" ? "ready" : "backlog",
      priority: input.priority ?? "medium",
      objective: input.objective ?? "",
      background: input.background ?? "",
      scope: input.scope ?? [],
      outOfScope: input.outOfScope ?? [],
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      constraints: input.constraints ?? [],
      decisions: input.decisions ?? [],
      references: input.references ?? [],
      affectedAreas: input.affectedAreas ?? [],
      dependencies: input.dependencies ?? [],
      prerequisites: input.prerequisites ?? [],
      implementationNotes: [],
      progress: [],
      createdAt: now,
      updatedAt: now,
    };
  }
}

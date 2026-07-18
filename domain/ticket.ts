/**
 * Core ticket domain model.
 *
 * These types describe the durable, on-disk contract for a work ticket. They
 * are pure data plus small read-only helpers; lifecycle transitions and
 * mutation live in services (Milestone 2+).
 */

export type TicketStatus =
  | "backlog"
  | "ready"
  | "in_progress"
  | "in_review"
  | "blocked"
  | "done"
  | "cancelled";

export type Priority = "low" | "medium" | "high" | "critical";

export interface AcceptanceCriterion {
  id: string;
  description: string;
  completed: boolean;
  evidence?: string;
}

export type DependencyType = "blocked_by" | "related_to";

export interface TicketDependency {
  ticketId: string;
  type: DependencyType;
}

export type ProgressType =
  | "note"
  | "decision"
  | "implementation"
  | "verification"
  | "blocker"
  | "status_change";

export interface ProgressEntry {
  id: string;
  timestamp: string;
  type: ProgressType;
  content: string;
  /** Who left this entry (agent model id, or an explicit override). */
  author?: string;
}

/**
 * A complete work ticket.
 *
 * The index signature preserves unknown future fields across read/write cycles
 * so the workboard keeps working when new fields are added (see storage
 * validation). It does not weaken the known fields above.
 */
export interface WorkTicket {
  schemaVersion: 1;
  id: string;
  title: string;
  status: TicketStatus;
  priority: Priority;

  objective: string;
  background: string;
  scope: string[];
  outOfScope: string[];
  acceptanceCriteria: AcceptanceCriterion[];

  constraints: string[];
  decisions: string[];
  references: string[];
  affectedAreas: string[];

  dependencies: TicketDependency[];
  /** Setup steps that must be satisfied before/while working the ticket. */
  prerequisites: string[];
  /** Path to the git worktree where work on this ticket happens, if any. */
  worktree?: string;
  blockedReason?: string;

  implementationNotes: string[];
  verificationSummary?: string;
  progress: ProgressEntry[];

  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;

  // Preserve unknown future fields where practical.
  [key: string]: unknown;
}

/**
 * Injected clock. Used by services to stamp timestamps; never calls `Date`
 * directly so tests stay deterministic.
 */
export interface Clock {
  now(): string;
}

/**
 * The subset of fields that gate a ticket moving from `backlog` to `ready`.
 * Mirrors the blueprint's "Required refinement fields".
 */
export type RefinementFields = Pick<
  WorkTicket,
  "title" | "objective" | "background" | "scope" | "acceptanceCriteria"
>;

/**
 * Return the required refinement fields that are still missing on a ticket.
 * An empty array means the ticket may become `ready`.
 */
export function getMissingRefinementFields(
  ticket: RefinementFields,
): string[] {
  const missing: string[] = [];
  if (!ticket.title || ticket.title.trim().length === 0) missing.push("title");
  if (!ticket.objective || ticket.objective.trim().length === 0)
    missing.push("objective");
  if (!ticket.background || ticket.background.trim().length === 0)
    missing.push("background");
  if (!ticket.scope || ticket.scope.length === 0) missing.push("scope");
  if (!ticket.acceptanceCriteria || ticket.acceptanceCriteria.length === 0)
    missing.push("acceptanceCriteria");
  return missing;
}

export function isRefinementComplete(ticket: RefinementFields): boolean {
  return getMissingRefinementFields(ticket).length === 0;
}

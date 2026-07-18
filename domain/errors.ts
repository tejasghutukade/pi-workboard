/**
 * Typed domain errors for the Pi Workboard.
 *
 * Every error carries a stable `code` (safe to branch on / surface in tool
 * output) and a human-readable `message` that explains what failed and, where
 * possible, how to resolve it. Raw stack traces are never part of the message.
 */

export type WorkboardErrorCode =
  | "TICKET_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INCOMPLETE_TICKET"
  | "UNRESOLVED_DEPENDENCY"
  | "ACTIVE_TICKET_EXISTS"
  | "ACCEPTANCE_INCOMPLETE"
  | "CRITERION_NOT_FOUND"
  | "DUPLICATE_TICKET_ID"
  | "CORRUPT_WORKBOARD";

export class WorkboardError extends Error {
  readonly code: WorkboardErrorCode;

  constructor(code: WorkboardErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TicketNotFoundError extends WorkboardError {
  constructor(id: string) {
    super("TICKET_NOT_FOUND", `Ticket ${id} was not found.`);
  }
}

export class InvalidTransitionError extends WorkboardError {
  constructor(from: string, to: string, reason?: string) {
    const detail = reason ? ` ${reason}` : "";
    super(
      "INVALID_TRANSITION",
      `Cannot transition ticket from "${from}" to "${to}".${detail}`,
    );
  }
}

export class IncompleteTicketError extends WorkboardError {
  constructor(missing: string[]) {
    super(
      "INCOMPLETE_TICKET",
      `Ticket is missing required refinement fields: ${missing.join(", ")}. ` +
        `Add them before moving the ticket to "ready".`,
    );
  }
}

export class UnresolvedDependencyError extends WorkboardError {
  constructor(blockingIds: string[], reason?: string) {
    const detail = reason ? ` ${reason}` : "";
    super(
      "UNRESOLVED_DEPENDENCY",
      `Ticket is blocked by unresolved dependency on: ${blockingIds.join(", ")}. ` +
        `Resolve or remove those dependencies before continuing.${detail}`,
    );
  }
}

export class AcceptanceCriteriaIncompleteError extends WorkboardError {
  constructor(incompleteIds: string[]) {
    super(
      "ACCEPTANCE_INCOMPLETE",
      `Cannot complete the ticket: acceptance criteria are not all verified ` +
        `(${incompleteIds.length} incomplete). Every criterion needs completion plus evidence.`,
    );
  }
}

export class CriterionNotFoundError extends WorkboardError {
  constructor(ticketId: string, criterionId: string) {
    super(
      "CRITERION_NOT_FOUND",
      `Acceptance criterion ${criterionId} was not found on ticket ${ticketId}.`,
    );
  }
}

export class DuplicateTicketIdError extends WorkboardError {
  constructor(id: string) {
    super(
      "DUPLICATE_TICKET_ID",
      `A ticket with id ${id} already exists; refusing to overwrite it. ` +
        `This indicates a parallel ID-allocation race — report it as a bug.`,
    );
  }
}

export class CorruptWorkboardError extends WorkboardError {
  constructor(detail: string) {
    super(
      "CORRUPT_WORKBOARD",
      `Workboard data is corrupt and was not modified: ${detail}. ` +
        `Fix or restore the affected file; do not rely on auto-repair.`,
    );
  }
}

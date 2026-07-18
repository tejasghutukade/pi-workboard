/**
 * Validation for on-disk ticket and board data.
 *
 * Rules:
 * - Every ticket/board is validated after reading.
 * - Malformed data throws `CorruptWorkboardError` (never silently discarded or
 *   repaired).
 * - Unknown future fields are preserved by copying them onto the result.
 *
 * Validation is intentionally hand-written (no external schema dependency) so
 * the error messages stay specific and actionable.
 */

import { CorruptWorkboardError } from "../domain/errors.js";
import { DEFAULT_ID_PREFIX } from "../domain/board.js";
import type {
  AcceptanceCriterion,
  DependencyType,
  ProgressEntry,
  ProgressType,
  TicketDependency,
  TicketStatus,
  WorkTicket,
} from "../domain/ticket.js";
import type { BoardMetadata } from "../domain/board.js";

/** Build the ticket-id regex for a given prefix (default "WB"). */
export function makeTicketIdRegex(prefix: string = DEFAULT_ID_PREFIX): RegExp {
  return new RegExp(`^${prefix}-\\d{4}$`);
}
const STATUSES: readonly TicketStatus[] = [
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
];
const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const DEPENDENCY_TYPES: readonly DependencyType[] = ["blocked_by", "related_to"];
const PROGRESS_TYPES: readonly ProgressType[] = [
  "note",
  "decision",
  "implementation",
  "verification",
  "blocker",
  "status_change",
];

const KNOWN_TICKET_KEYS = new Set([
  "schemaVersion",
  "id",
  "title",
  "status",
  "priority",
  "objective",
  "background",
  "scope",
  "outOfScope",
  "acceptanceCriteria",
  "constraints",
  "decisions",
  "references",
  "affectedAreas",
  "dependencies",
  "prerequisites",
  "worktree",
  "blockedReason",
  "implementationNotes",
  "verificationSummary",
  "progress",
  "createdAt",
  "updatedAt",
  "startedAt",
  "completedAt",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new CorruptWorkboardError(message);
}

function asString(value: unknown, field: string): string {
  assert(typeof value === "string", `"${field}" must be a string`);
  return value;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, field);
}

function asStringArray(value: unknown, field: string): string[] {
  assert(Array.isArray(value), `"${field}" must be an array of strings`);
  for (const item of value) {
    assert(typeof item === "string", `"${field}" must contain only strings`);
  }
  return value as string[];
}

function validateAcceptanceCriterion(
  raw: unknown,
  index: number,
): AcceptanceCriterion {
  assert(isObject(raw), `acceptanceCriteria[${index}] must be an object`);
  return {
    id: asString(raw.id, `acceptanceCriteria[${index}].id`),
    description: asString(
      raw.description,
      `acceptanceCriteria[${index}].description`,
    ),
    completed:
      typeof raw.completed === "boolean"
        ? raw.completed
        : (assert(false, `acceptanceCriteria[${index}].completed must be a boolean`),
          false),
    evidence: asOptionalString(raw.evidence, `acceptanceCriteria[${index}].evidence`),
  };
}

function validateDependency(raw: unknown, index: number): TicketDependency {
  assert(isObject(raw), `dependencies[${index}] must be an object`);
  const type = asString(raw.type, `dependencies[${index}].type`);
  assert(
    (DEPENDENCY_TYPES as readonly string[]).includes(type),
    `dependencies[${index}].type must be "blocked_by" or "related_to"`,
  );
  return {
    ticketId: asString(raw.ticketId, `dependencies[${index}].ticketId`),
    type: type as DependencyType,
  };
}

function validateProgressEntry(raw: unknown, index: number): ProgressEntry {
  assert(isObject(raw), `progress[${index}] must be an object`);
  const type = asString(raw.type, `progress[${index}].type`);
  assert(
    (PROGRESS_TYPES as readonly string[]).includes(type),
    `progress[${index}].type must be one of: ${PROGRESS_TYPES.join(", ")}`,
  );
  return {
    id: asString(raw.id, `progress[${index}].id`),
    timestamp: asString(raw.timestamp, `progress[${index}].timestamp`),
    type: type as ProgressType,
    content: asString(raw.content, `progress[${index}].content`),
    author: asOptionalString(raw.author, `progress[${index}].author`),
  };
}

export function validateTicket(raw: unknown, prefix: string = DEFAULT_ID_PREFIX): WorkTicket {
  assert(isObject(raw), "Ticket must be a JSON object");

  const schemaVersion = raw.schemaVersion;
  assert(
    schemaVersion === 1,
    `Ticket schemaVersion must be 1, received: ${JSON.stringify(schemaVersion)}`,
  );

  const id = asString(raw.id, "id");
  const idRe = makeTicketIdRegex(prefix);
  assert(
    idRe.test(id),
    `Ticket id must match ${prefix}-#### (received "${id}")`,
  );

  const status = asString(raw.status, "status");
  assert(
    (STATUSES as readonly string[]).includes(status),
    `Ticket status must be one of: ${STATUSES.join(", ")}`,
  );

  const priority = asString(raw.priority, "priority");
  assert(
    (PRIORITIES as readonly unknown[]).includes(priority),
    `Ticket priority must be one of: ${PRIORITIES.join(", ")}`,
  );

  const result: WorkTicket = {
    schemaVersion: 1,
    id,
    title: asString(raw.title, "title"),
    status: status as TicketStatus,
    priority: priority as WorkTicket["priority"],
    objective: asString(raw.objective, "objective"),
    background: asString(raw.background, "background"),
    scope: asStringArray(raw.scope, "scope"),
    outOfScope: asStringArray(raw.outOfScope, "outOfScope"),
    acceptanceCriteria: Array.isArray(raw.acceptanceCriteria)
      ? raw.acceptanceCriteria.map((c, i) => validateAcceptanceCriterion(c, i))
      : (assert(false, "acceptanceCriteria must be an array"), []),
    constraints: asStringArray(raw.constraints, "constraints"),
    decisions: asStringArray(raw.decisions, "decisions"),
    references: asStringArray(raw.references, "references"),
    affectedAreas: asStringArray(raw.affectedAreas, "affectedAreas"),
    dependencies: Array.isArray(raw.dependencies)
      ? raw.dependencies.map((d, i) => validateDependency(d, i))
      : (assert(false, "dependencies must be an array"), []),
    prerequisites: Array.isArray(raw.prerequisites)
      ? asStringArray(raw.prerequisites, "prerequisites")
      : [],
    blockedReason: asOptionalString(raw.blockedReason, "blockedReason"),
    worktree: asOptionalString(raw.worktree, "worktree"),
    implementationNotes: asStringArray(
      raw.implementationNotes,
      "implementationNotes",
    ),
    verificationSummary: asOptionalString(
      raw.verificationSummary,
      "verificationSummary",
    ),
    progress: Array.isArray(raw.progress)
      ? raw.progress.map((p, i) => validateProgressEntry(p, i))
      : (assert(false, "progress must be an array"), []),
    createdAt: asString(raw.createdAt, "createdAt"),
    updatedAt: asString(raw.updatedAt, "updatedAt"),
    startedAt: asOptionalString(raw.startedAt, "startedAt"),
    completedAt: asOptionalString(raw.completedAt, "completedAt"),
  };

  // Preserve unknown future fields.
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TICKET_KEYS.has(key)) {
      (result as Record<string, unknown>)[key] = raw[key];
    }
  }

  return result;
}

export function validateBoard(raw: unknown): BoardMetadata {
  assert(isObject(raw), "Board metadata must be a JSON object");

  const schemaVersion = raw.schemaVersion;
  assert(
    schemaVersion === 1,
    `Board schemaVersion must be 1, received: ${JSON.stringify(schemaVersion)}`,
  );

  const nextTicketNumber = raw.nextTicketNumber;
  assert(
    typeof nextTicketNumber === "number" &&
      Number.isInteger(nextTicketNumber) &&
      nextTicketNumber >= 1,
    "Board nextTicketNumber must be an integer >= 1",
  );

  const result: BoardMetadata = {
    schemaVersion: 1,
    nextTicketNumber,
  };

  const KNOWN_BOARD_KEYS = new Set(["schemaVersion", "nextTicketNumber"]);
  for (const key of Object.keys(raw)) {
    if (!KNOWN_BOARD_KEYS.has(key)) {
      (result as Record<string, unknown>)[key] = raw[key];
    }
  }

  return result;
}

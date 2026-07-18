/**
 * Board metadata: the small piece of global state shared across tickets
 * (next ID counter and the single active ticket).
 */

export interface BoardMetadata {
  schemaVersion: 1;
  nextTicketNumber: number;

  /** Prefix used when formatting ticket ids (e.g. "WB" -> "WB-0001").
   * Optional; when absent the default prefix is used. */
  idPrefix?: string;

  // Preserve unknown future fields where practical.
  [key: string]: unknown;
}

export const DEFAULT_ID_PREFIX = "WB";

/**
 * Generates sequential, human-readable ticket IDs. Implementations decide how
 * the counter is sourced and persisted (Milestone 1 uses board metadata).
 */
export interface IdGenerator {
  nextId(): Promise<string>;
}

export const DEFAULT_BOARD_METADATA: BoardMetadata = {
  schemaVersion: 1,
  nextTicketNumber: 1,
};

/** Format a 1-based ticket number as `WB-0001` (or `<prefix>-0001`). */
export function formatTicketId(
  number: number,
  prefix: string = DEFAULT_ID_PREFIX,
): string {
  return `${prefix}-${String(number).padStart(4, "0")}`;
}

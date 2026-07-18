/**
 * Sequential ticket ID generator backed by board metadata.
 *
 * `nextId()` reads the current `nextTicketNumber`, formats `WB-####`, and
 * persists the incremented counter. Allocation is serialized by an in-instance
 * promise-chain lock (see `chain`) so concurrent `nextId()` calls — including
 * those from parallel agents — never read the same counter value and collide.
 */

import type { BoardMetadata, IdGenerator } from "../domain/board.js";
import { DEFAULT_ID_PREFIX, formatTicketId } from "../domain/board.js";
import type { BoardRepository } from "./board-repository.js";

export class SequentialIdGenerator implements IdGenerator {
  /**
   * Serializes `nextId()` so concurrent callers never read the same
   * `nextTicketNumber`. The workboard constructs one shared generator instance
   * (services/workboard.ts), so this in-process lock makes ID allocation
   * exclusive across all callers — including any parallel agents.
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly board: BoardRepository) {}

  async nextId(): Promise<string> {
    const run = this.chain.then(() => this.allocate());
    // Keep the chain alive even if a run rejects, but surface the error.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async allocate(): Promise<string> {
    const meta: BoardMetadata = await this.board.get();
    const prefix = meta.idPrefix ?? DEFAULT_ID_PREFIX;
    const id = formatTicketId(meta.nextTicketNumber, prefix);
    await this.board.update({
      ...meta,
      nextTicketNumber: meta.nextTicketNumber + 1,
    });
    return id;
  }
}

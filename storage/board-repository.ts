/**
 * Board metadata repository: the single source of truth for the global board
 * state (next ID counter + active ticket id). Stored as `board.json` inside the
 * workboard directory.
 */


import path from "node:path";
import type { BoardMetadata } from "../domain/board.js";
import { DEFAULT_BOARD_METADATA } from "../domain/board.js";
import { JsonFileStore } from "./json-file-store.js";
import { validateBoard } from "./validation.js";

export interface BoardRepository {
  get(): Promise<BoardMetadata>;
  update(board: BoardMetadata): Promise<void>;
}

/**
 * File-backed board repository.
 *
 * @param workboardDir directory that holds `board.json` (typically `.pi/workboard`).
 * @param store optional `JsonFileStore` (injectable for tests).
 * @param _clock reserved for future timestamping of board metadata; unused in M1.
 */
export class FileBoardRepository implements BoardRepository {
  private readonly store: JsonFileStore;
  private readonly file: string;

  constructor(
    workboardDir: string,
    store?: JsonFileStore,
  ) {
    this.store = store ?? new JsonFileStore();
    this.file = path.join(workboardDir, "board.json");
  }

  async get(): Promise<BoardMetadata> {
    const raw = await this.store.readJson<unknown>(this.file);
    if (raw === null) {
      return { ...DEFAULT_BOARD_METADATA };
    }
    return validateBoard(raw);
  }

  async update(board: BoardMetadata): Promise<void> {
    await this.store.writeJson(this.file, board);
  }
}

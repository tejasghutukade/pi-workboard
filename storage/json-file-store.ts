/**
 * Atomic JSON file storage.
 *
 * - Reads return `null` when the file is missing (caller decides default).
 * - Writes are atomic: serialize to a temp file in the same directory, then
 *   `rename` over the destination. `rename` is atomic on a single filesystem,
 *   so a crash mid-write leaves the old file intact (never a half-written one).
 * - UTF-8 encoding, two-space indentation.
 * - The fs module is injectable so tests can spy on individual operations
 *   (e.g. to simulate a failed rename and verify atomicity).
 */

import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { CorruptWorkboardError } from "../domain/errors.js";

type FsModule = typeof nodeFs;

export class JsonFileStore {
  constructor(private readonly fsModule: FsModule = nodeFs) {}

  /** Read and parse JSON. Returns null if the file does not exist. */
  async readJson<T>(filePath: string): Promise<T | null> {
    let content: string;
    try {
      content = await this.fsModule.readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    try {
      return JSON.parse(content) as T;
    } catch (err) {
      throw new CorruptWorkboardError(
        `Failed to parse JSON at ${filePath}: ${(err as Error).message}`,
      );
    }
  }

  /** Returns true if a file exists at the given path. */
  async exists(filePath: string): Promise<boolean> {
    try {
      await this.fsModule.access(filePath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  /** Atomically write JSON (UTF-8, 2-space indent). */
  async writeJson(filePath: string, data: unknown): Promise<void> {
    const dir = path.dirname(filePath);
    await this.fsModule.mkdir(dir, { recursive: true });

    const tmp = path.join(
      dir,
      `.${path.basename(filePath)}.${process.pid}.${Math.random()
        .toString(36)
        .slice(2)}.tmp`,
    );
    const serialized = JSON.stringify(data, null, 2);

    try {
      await this.fsModule.writeFile(tmp, serialized, "utf8");
      await this.fsModule.rename(tmp, filePath);
    } catch (err) {
      // Never leave a stray temp file behind on failure.
      await this.fsModule.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }
}

/**
 * Ticket repository: one JSON file per ticket under `<workboardDir>/tickets/`.
 * JSON is the only source of truth (no duplicate Markdown). Every ticket is
 * validated on read; malformed data is reported, never repaired.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkTicket } from "../domain/ticket.js";
import { JsonFileStore } from "./json-file-store.js";
import { DuplicateTicketIdError } from "../domain/errors.js";
import { DEFAULT_ID_PREFIX } from "../domain/board.js";
import { validateTicket } from "./validation.js";

export interface TicketRepository {
  create(ticket: WorkTicket): Promise<void>;
  get(id: string): Promise<WorkTicket | null>;
  update(ticket: WorkTicket): Promise<void>;
  list(): Promise<WorkTicket[]>;
}

export class FileTicketRepository implements TicketRepository {
  private readonly store: JsonFileStore;
  private readonly ticketsDir: string;
  private readonly idPrefix: string;

  constructor(
    workboardDir: string,
    store?: JsonFileStore,
    idPrefix: string = DEFAULT_ID_PREFIX,
  ) {
    this.store = store ?? new JsonFileStore();
    this.ticketsDir = path.join(workboardDir, "tickets");
    this.idPrefix = idPrefix;
  }

  private fileFor(id: string): string {
    return path.join(this.ticketsDir, `${id}.json`);
  }

  async create(ticket: WorkTicket): Promise<void> {
    // Refuse to overwrite an existing ticket file. Without this guard a residual
    // ID-allocation race (or any duplicate id) would silently lose data.
    if (await this.store.exists(this.fileFor(ticket.id))) {
      throw new DuplicateTicketIdError(ticket.id);
    }
    await this.store.writeJson(this.fileFor(ticket.id), ticket);
  }

  async get(id: string): Promise<WorkTicket | null> {
    const raw = await this.store.readJson<unknown>(this.fileFor(id));
    if (raw === null) return null;
    return validateTicket(raw, this.idPrefix);
  }

  async update(ticket: WorkTicket): Promise<void> {
    await this.store.writeJson(this.fileFor(ticket.id), ticket);
  }

  async list(): Promise<WorkTicket[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.ticketsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const tickets: WorkTicket[] = [];
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const raw = await this.store.readJson<unknown>(
        path.join(this.ticketsDir, name),
      );
      // A missing file mid-listing is a no-op; null should not occur here.
      if (raw === null) continue;
      tickets.push(validateTicket(raw, this.idPrefix));
    }

    // Stable, deterministic order by ticket id.
    tickets.sort((a, b) => a.id.localeCompare(b.id));
    return tickets;
  }
}

/**
 * Per-session active ticket.
 *
 * The workboard allows parallel work, so multiple tickets may be `in_progress`
 * at once. Each session, however, works on its own ticket — started via
 * `/ticket-work`. This service records, per session id, which ticket that
 * session is actively working on, so the session footer/context can show the
 * session's own active ticket rather than the global `in_progress` set.
 */

import { JsonFileStore } from "../storage/json-file-store.js";
import path from "node:path";

export interface SessionActiveTicket {
  sessionId: string;
  ticketId: string;
}

export class SessionActiveService {
  private readonly file: string;

  constructor(
    storeDir: string,
    private readonly store: JsonFileStore,
  ) {
    this.file = path.join(storeDir, "session-active.json");
  }

  private async readAll(): Promise<SessionActiveTicket[]> {
    const parsed = await this.store.readJson<unknown>(this.file);
    if (Array.isArray(parsed)) return parsed as SessionActiveTicket[];
    return [];
  }

  private async writeAll(entries: SessionActiveTicket[]): Promise<void> {
    await this.store.writeJson(this.file, entries);
  }

  /** The ticket id this session is actively working on, or undefined. */
  async get(sessionId: string): Promise<string | undefined> {
    const entries = await this.readAll();
    return entries.find((e) => e.sessionId === sessionId)?.ticketId;
  }

  /** Set (or replace) this session's active ticket. */
  async set(sessionId: string, ticketId: string): Promise<void> {
    const entries = await this.readAll();
    const idx = entries.findIndex((e) => e.sessionId === sessionId);
    if (idx >= 0) entries[idx] = { sessionId, ticketId };
    else entries.push({ sessionId, ticketId });
    await this.writeAll(entries);
  }

  /** Clear this session's active ticket (e.g. on completion/cancel). */
  async clear(sessionId: string): Promise<void> {
    const entries = await this.readAll();
    const next = entries.filter((e) => e.sessionId !== sessionId);
    await this.writeAll(next);
  }
}

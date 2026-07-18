/**
 * Shared test utilities for service-layer and extension tests.
 *
 * `setup()` wires real file-backed repositories (in a temp dir) to the services
 * via the shared `createWorkboardEnvironment` factory, so tests exercise the
 * full storage + service stack. Not a test file itself.
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Clock, WorkTicket } from "../domain/ticket.js";
import { FileBoardRepository } from "../storage/board-repository.js";
import { FileTicketRepository } from "../storage/ticket-repository.js";
import { createWorkboardEnvironment, type WorkboardEnvironment } from "../services/workboard.js";

export class FixedClock implements Clock {
  constructor(public readonly nowStr = "2024-01-01T00:00:00.000Z") {}
  now(): string {
    return this.nowStr;
  }
}

export function makeTicket(id: string, overrides: Partial<WorkTicket> = {}): WorkTicket {
  return {
    schemaVersion: 1,
    id,
    title: `Ticket ${id}`,
    status: "backlog",
    priority: "medium",
    objective: "Objective for " + id,
    background: "Background for " + id,
    scope: ["Implement the feature"],
    outOfScope: ["Out of scope"],
    acceptanceCriteria: [{ id: "AC-1", description: "It works", completed: false }],
    constraints: [],
    decisions: [],
    references: [],
    affectedAreas: [],
    dependencies: [],
    prerequisites: [],
    implementationNotes: [],
    progress: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export interface TestEnv extends WorkboardEnvironment {
  tickets: FileTicketRepository;
  board: FileBoardRepository;
  dir: string;
  clock: FixedClock;
  cleanup: () => Promise<void>;
}

export async function setup(): Promise<TestEnv> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wb-svc-"));
  const workboardDir = path.join(root, ".pi", "workboard");
  const clock = new FixedClock();
  const env = await createWorkboardEnvironment(workboardDir, clock);
  return {
    ...env,
    tickets: env.ticketRepo,
    board: env.boardRepo,
    dir: workboardDir,
    clock,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** Create a fully-refined, ready ticket via the service. */
export async function createReady(
  env: TestEnv,
  overrides: Parameters<WorkboardEnvironment["ticketService"]["create"]>[0] = {},
): Promise<string> {
  const result = await env.ticketService.create({
    status: "ready",
    title: overrides.title ?? "Ready ticket",
    objective: overrides.objective ?? "Do it",
    background: overrides.background ?? "Because",
    scope: overrides.scope ?? ["Build it"],
    acceptanceCriteria:
      overrides.acceptanceCriteria ?? [{ id: "AC-1", description: "Works", completed: false }],
    priority: overrides.priority,
    dependencies: overrides.dependencies,
  });
  return result.id;
}

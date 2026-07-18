/**
 * Workboard environment factory (shared by the production composition root in
 * `index.ts` and the test harness in `tests/helpers.ts`). Wires file-backed
 * repositories to the services so there is a single place that knows how to
 * build a working environment for a given workboard directory.
 */

import type { Clock } from "../domain/ticket.js";
import { FileBoardRepository } from "../storage/board-repository.js";
import { FileTicketRepository } from "../storage/ticket-repository.js";
import { JsonFileStore } from "../storage/json-file-store.js";
import { SequentialIdGenerator } from "../storage/id-generator.js";
import { DependencyService } from "./dependency-service.js";
import { TicketService } from "./ticket-service.js";
import { LifecycleService } from "./lifecycle-service.js";
import { SelectionService } from "./selection-service.js";
import { SessionActiveService } from "./session-active.js";

class RealClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export interface WorkboardEnvironment {
  ticketRepo: FileTicketRepository;
  boardRepo: FileBoardRepository;
  deps: DependencyService;
  ticketService: TicketService;
  lifecycle: LifecycleService;
  selection: SelectionService;
  sessionActive: SessionActiveService;
}

export async function createWorkboardEnvironment(
  dir: string,
  clock: Clock = new RealClock(),
): Promise<WorkboardEnvironment> {
  const boardRepo = new FileBoardRepository(dir);
  const boardMeta = await boardRepo.get();
  const ticketRepo = new FileTicketRepository(dir, undefined, boardMeta.idPrefix ?? "WB");
  const idGenerator = new SequentialIdGenerator(boardRepo);
  const deps = new DependencyService(ticketRepo);
  const ticketService = new TicketService(ticketRepo, idGenerator, clock, deps);
  const lifecycle = new LifecycleService(ticketRepo, clock, deps, ticketService);
  const selection = new SelectionService(ticketRepo, deps);
  const jsonStore = new JsonFileStore();
  const sessionActive = new SessionActiveService(dir, jsonStore);
  return { ticketRepo, boardRepo, deps, ticketService, lifecycle, selection, sessionActive };
}

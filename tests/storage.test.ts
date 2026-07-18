import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkTicket } from "../domain/ticket.js";
import { CorruptWorkboardError, DuplicateTicketIdError } from "../domain/errors.js";
import { JsonFileStore } from "../storage/json-file-store.js";
import { FileBoardRepository } from "../storage/board-repository.js";
import { FileTicketRepository } from "../storage/ticket-repository.js";
import { SequentialIdGenerator } from "../storage/id-generator.js";
import { validateTicket, validateBoard, makeTicketIdRegex } from "../storage/validation.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "wb-storage-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function workboardDir(): string {
  return path.join(tmpRoot, ".pi", "workboard");
}

function makeTicket(id: string, overrides: Partial<WorkTicket> = {}): WorkTicket {
  return {
    schemaVersion: 1,
    id,
    title: "Example ticket",
    status: "backlog",
    priority: "medium",
    objective: "Do the thing",
    background: "Because it is needed",
    scope: ["Implement X"],
    outOfScope: ["Implement Y"],
    acceptanceCriteria: [
      { id: "AC-1", description: "X works", completed: false },
    ],
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

describe("SequentialIdGenerator", () => {
  it("produces sequential WB-#### ids and advances the counter", async () => {
    const board = new FileBoardRepository(workboardDir());
    const gen = new SequentialIdGenerator(board);

    expect(await gen.nextId()).toBe("WB-0001");
    expect(await gen.nextId()).toBe("WB-0002");
    expect(await gen.nextId()).toBe("WB-0003");

    const meta = await board.get();
    expect(meta.nextTicketNumber).toBe(4);
  });

  it("continues from a persisted counter across generator instances", async () => {
    const dir = workboardDir();
    const first = new SequentialIdGenerator(new FileBoardRepository(dir));
    await first.nextId();
    await first.nextId();

    const second = new SequentialIdGenerator(new FileBoardRepository(dir));
    expect(await second.nextId()).toBe("WB-0003");
  });

  it("never returns duplicate ids under concurrent nextId() calls", async () => {
    const board = new FileBoardRepository(workboardDir());
    const gen = new SequentialIdGenerator(board);

    const N = 50;
    const ids = await Promise.all(
      Array.from({ length: N }, () => gen.nextId()),
    );

    expect(new Set(ids).size).toBe(N);
    expect(ids.sort()).toEqual(ids);
    const meta = await board.get();
    expect(meta.nextTicketNumber).toBe(N + 1);
  });

  it("honors a custom board idPrefix", async () => {
    const dir = workboardDir();
    const board = new FileBoardRepository(dir);
    const meta = await board.get();
    await board.update({ ...meta, idPrefix: "TSK" });

    const gen = new SequentialIdGenerator(board);
    expect(await gen.nextId()).toBe("TSK-0001");
    expect(await gen.nextId()).toBe("TSK-0002");
  });
});

describe("FileBoardRepository", () => {
  it("returns defaults when no board file exists", async () => {
    const board = new FileBoardRepository(workboardDir());
    const meta = await board.get();
    expect(meta.nextTicketNumber).toBe(1);
    expect(meta.activeTicketId).toBeUndefined();
  });

  it("round-trips board metadata", async () => {
    const board = new FileBoardRepository(workboardDir());
    await board.update({ schemaVersion: 1, nextTicketNumber: 7, activeTicketId: "WB-0003" });
    const meta = await board.get();
    expect(meta).toEqual({
      schemaVersion: 1,
      nextTicketNumber: 7,
      activeTicketId: "WB-0003",
    });
  });

  it("throws CorruptWorkboardError on malformed board JSON", async () => {
    const dir = workboardDir();
    await fs.mkdir(path.dirname(path.join(dir, "board.json")), { recursive: true });
    await fs.writeFile(path.join(dir, "board.json"), "{ not json", "utf8");
    await expect(new FileBoardRepository(dir).get()).rejects.toBeInstanceOf(
      CorruptWorkboardError,
    );
  });
});

describe("FileTicketRepository", () => {
  it("creates and reads a ticket", async () => {
    const repo = new FileTicketRepository(workboardDir());
    const ticket = makeTicket("WB-0001");
    await repo.create(ticket);
    const got = await repo.get("WB-0001");
    expect(got).toEqual(ticket);
  });

  it("refuses to overwrite an existing ticket and leaves it intact", async () => {
    const repo = new FileTicketRepository(workboardDir());
    const original = makeTicket("WB-0001", { title: "Original" });
    await repo.create(original);

    const clobber = makeTicket("WB-0001", { title: "Clobber" });
    await expect(repo.create(clobber)).rejects.toBeInstanceOf(
      DuplicateTicketIdError,
    );

    expect(await repo.get("WB-0001")).toEqual(original);
  });

  it("returns null for a missing ticket", async () => {
    const repo = new FileTicketRepository(workboardDir());
    expect(await repo.get("WB-9999")).toBeNull();
  });

  it("updates a ticket without losing data", async () => {
    const repo = new FileTicketRepository(workboardDir());
    await repo.create(makeTicket("WB-0001"));
    const updated = makeTicket("WB-0001", { status: "ready", title: "Renamed" });
    await repo.update(updated);
    expect(await repo.get("WB-0001")).toEqual(updated);
  });

  it("lists tickets sorted by id", async () => {
    const repo = new FileTicketRepository(workboardDir());
    await repo.create(makeTicket("WB-0003"));
    await repo.create(makeTicket("WB-0001"));
    await repo.create(makeTicket("WB-0002"));
    const ids = (await repo.list()).map((t) => t.id);
    expect(ids).toEqual(["WB-0001", "WB-0002", "WB-0003"]);
  });

  it("returns an empty list when the tickets directory is absent", async () => {
    expect(await new FileTicketRepository(workboardDir()).list()).toEqual([]);
  });

  it("throws CorruptWorkboardError on a malformed ticket file", async () => {
    const dir = workboardDir();
    await fs.mkdir(path.join(dir, "tickets"), { recursive: true });
    await fs.writeFile(path.join(dir, "tickets", "WB-0001.json"), "{ bad", "utf8");
    await expect(new FileTicketRepository(dir).get("WB-0001")).rejects.toBeInstanceOf(
      CorruptWorkboardError,
    );
  });

  it("throws CorruptWorkboardError on schema-invalid ticket content", async () => {
    const dir = workboardDir();
    await fs.mkdir(path.join(dir, "tickets"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "tickets", "WB-0001.json"),
      JSON.stringify({ schemaVersion: 1, id: "WB-0001", status: "nope" }),
      "utf8",
    );
    await expect(new FileTicketRepository(dir).get("WB-0001")).rejects.toBeInstanceOf(
      CorruptWorkboardError,
    );
  });
});

describe("validation preserves unknown fields", () => {
  it("keeps future fields when reading a ticket", async () => {
    const dir = workboardDir();
    const ticket = makeTicket("WB-0001", { triage: "soon" } as Partial<WorkTicket>);
    await new FileTicketRepository(dir).create(ticket);
    const got = await new FileTicketRepository(dir).get("WB-0001");
    expect((got as Record<string, unknown>).triage).toBe("soon");
  });

  it("keeps future fields when reading the board", async () => {
    const board = new FileBoardRepository(workboardDir());
    await board.update({
      schemaVersion: 1,
      nextTicketNumber: 2,
      custom: "value",
    } as never);
    const meta = await board.get();
    expect((meta as Record<string, unknown>).custom).toBe("value");
  });

  it("rejects unsupported schemaVersion", () => {
    expect(() => validateTicket({ schemaVersion: 2, id: "WB-0001" })).toThrow(
      CorruptWorkboardError,
    );
    expect(() => validateBoard({ schemaVersion: 2, nextTicketNumber: 1 })).toThrow(
      CorruptWorkboardError,
    );
  });

  it("accepts a custom id prefix when supplied", () => {
    const wb = makeTicketIdRegex("WB");
    const tsk = makeTicketIdRegex("TSK");
    expect(wb.test("WB-0001")).toBe(true);
    expect(tsk.test("TSK-0001")).toBe(true);
    expect(tsk.test("WB-0001")).toBe(false);
    // Defaults to WB when no prefix passed.
    expect(makeTicketIdRegex().test("WB-0001")).toBe(true);
  });
});

describe("atomic writes", () => {
  it("writes via a temp file then renames, leaving valid content", async () => {
    const store = new JsonFileStore();
    const file = path.join(workboardDir(), "board.json");
    await store.writeJson(file, { schemaVersion: 1, nextTicketNumber: 1 });
    const content = await fs.readFile(file, "utf8");
    expect(JSON.parse(content)).toEqual({ schemaVersion: 1, nextTicketNumber: 1 });
    // No stray temp files remain.
    const dirEntries = await fs.readdir(path.dirname(file));
    expect(dirEntries).toEqual(["board.json"]);
  });

  it("does not corrupt the destination and cleans up the temp on a failed rename", async () => {
    const original = { schemaVersion: 1, nextTicketNumber: 1 };
    const file = path.join(workboardDir(), "board.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(original), "utf8");

    const spy = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(new Error("simulated rename failure"));

    const store = new JsonFileStore();
    await expect(
      store.writeJson(file, { schemaVersion: 1, nextTicketNumber: 2 }),
    ).rejects.toThrow("simulated rename failure");

    spy.mockRestore();

    // Destination is unchanged.
    const after = JSON.parse(await fs.readFile(file, "utf8"));
    expect(after).toEqual(original);

    // No temp file left behind.
    const dirEntries = await fs.readdir(path.dirname(file));
    expect(dirEntries).toEqual(["board.json"]);
  });
});

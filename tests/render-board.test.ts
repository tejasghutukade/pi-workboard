import { describe, expect, it } from "vitest";
import type { WorkTicket } from "../domain/ticket.js";
import { renderBoard } from "../pi/render-board.js";

function make(id: string, status: WorkTicket["status"], over: Partial<WorkTicket> = {}): WorkTicket {
  const base: WorkTicket = {
    schemaVersion: 1,
    id,
    title: `Ticket ${id}`,
    objective: "",
    background: "",
    scope: [],
    outOfScope: [],
    acceptanceCriteria: [],
    constraints: [],
    decisions: [],
    references: [],
    affectedAreas: [],
    dependencies: [],
    prerequisites: [],
    implementationNotes: [],
    progress: [],
    status,
    priority: "medium",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
  return { ...base, ...over };
}

describe("renderBoard Done section", () => {
  it("orders done tickets newest-completed first", () => {
    const tickets = [
      make("WB-0001", "done", { completedAt: "2024-03-01T00:00:00.000Z" }),
      make("WB-0002", "done", { completedAt: "2024-05-01T00:00:00.000Z" }),
      make("WB-0003", "done", { completedAt: "2024-04-01T00:00:00.000Z" }),
    ];
    const out = renderBoard(tickets).join("\n");
    const i2 = out.indexOf("WB-0002");
    const i3 = out.indexOf("WB-0003");
    const i1 = out.indexOf("WB-0001");
    expect(i2).toBeLessThan(i3);
    expect(i3).toBeLessThan(i1);
  });

  it("falls back to updatedAt when completedAt is missing", () => {
    const tickets = [
      make("WB-0001", "done", { updatedAt: "2024-03-01T00:00:00.000Z" }),
      make("WB-0002", "done", { updatedAt: "2024-05-01T00:00:00.000Z" }),
      make("WB-0003", "done", { completedAt: "2024-04-01T00:00:00.000Z" }),
    ];
    const out = renderBoard(tickets).join("\n");
    // WB-0002 (updated May) should still appear above WB-0003 (completed Apr).
    expect(out.indexOf("WB-0002")).toBeLessThan(out.indexOf("WB-0003"));
  });

  it("caps the visible done tickets but reports the true total", () => {
    const tickets: WorkTicket[] = [];
    for (let i = 1; i <= 8; i++) {
      tickets.push(
        make(`WB-000${i}`, "done", {
          completedAt: `2024-06-${String(i).padStart(2, "0")}T00:00:00.000Z`,
        }),
      );
    }
    const out = renderBoard(tickets);
    const joined = out.join("\n");
    expect(joined).toContain("Done (showing 5 of 8)");
    // Only 5 done tickets are listed (plus the header). Count occurrences.
    const doneLines = out.filter((l) => l.includes("WB-000")).length;
    expect(doneLines).toBe(5);
    // Newest (WB-0008) is on top, oldest (WB-0001) is collapsed out.
    expect(joined.indexOf("WB-0008")).toBeLessThan(joined.indexOf("WB-0007"));
    expect(joined).not.toContain("WB-0001");
  });

  it("does not cap when there are few done tickets", () => {
    const tickets = [
      make("WB-0001", "done", { completedAt: "2024-03-01T00:00:00.000Z" }),
      make("WB-0002", "done", { completedAt: "2024-05-01T00:00:00.000Z" }),
    ];
    const joined = renderBoard(tickets).join("\n");
    expect(joined).toContain("Done (showing 2 of 2)");
  });
});

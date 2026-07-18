import { describe, expect, it } from "vitest";
import {
  getMissingRefinementFields,
  isRefinementComplete,
  type AcceptanceCriterion,
  type RefinementFields,
} from "../domain/ticket.js";
import {
  canTransition,
  isTerminalStatus,
  ALLOWED_TRANSITIONS,
} from "../domain/status.js";
import { formatTicketId } from "../domain/board.js";

function criteria(...descriptions: string[]): AcceptanceCriterion[] {
  return descriptions.map((description, i) => ({
    id: `AC-${i + 1}`,
    description,
    completed: false,
  }));
}

function completeRefinement(): RefinementFields {
  return {
    title: "Add login",
    objective: "Let users authenticate",
    background: "Needed for personalization",
    scope: ["Build form"],
    acceptanceCriteria: criteria("Form submits"),
  };
}

describe("refinement completeness", () => {
  it("reports no missing fields for a complete ticket", () => {
    expect(getMissingRefinementFields(completeRefinement())).toEqual([]);
    expect(isRefinementComplete(completeRefinement())).toBe(true);
  });

  it("lists every missing required field", () => {
    const missing = getMissingRefinementFields({
      title: "",
      objective: "",
      background: "",
      scope: [],
      acceptanceCriteria: [],
    });
    expect(missing.sort()).toEqual(
      ["acceptanceCriteria", "background", "objective", "scope", "title"].sort(),
    );
    expect(isRefinementComplete({
      title: "",
      objective: "",
      background: "",
      scope: [],
      acceptanceCriteria: [],
    })).toBe(false);
  });

  it("treats whitespace-only title as missing", () => {
    expect(
      getMissingRefinementFields({ ...completeRefinement(), title: "   " }),
    ).toContain("title");
  });

  it("requires at least one scope item and one acceptance criterion", () => {
    const r = completeRefinement();
    expect(getMissingRefinementFields({ ...r, scope: [] })).toContain("scope");
    expect(
      getMissingRefinementFields({ ...r, acceptanceCriteria: [] }),
    ).toContain("acceptanceCriteria");
  });
});

describe("lifecycle transitions", () => {
  it("allows the documented forward flow", () => {
    expect(canTransition("backlog", "ready")).toBe(true);
    expect(canTransition("ready", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "in_review")).toBe(true);
    expect(canTransition("in_review", "done")).toBe(true);
  });

  it("allows blocked <-> ready", () => {
    expect(canTransition("in_progress", "blocked")).toBe(true);
    expect(canTransition("blocked", "ready")).toBe(true);
  });

  it("allows cancellation from backlog, ready, and blocked", () => {
    expect(canTransition("backlog", "cancelled")).toBe(true);
    expect(canTransition("ready", "cancelled")).toBe(true);
    expect(canTransition("blocked", "cancelled")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("done", "ready")).toBe(false);
    expect(canTransition("ready", "blocked")).toBe(false);
    expect(canTransition("backlog", "in_progress")).toBe(false);
    expect(canTransition("cancelled", "backlog")).toBe(false);
    expect(canTransition("done", "cancelled")).toBe(false);
  });

  it("marks done and cancelled as terminal", () => {
    expect(isTerminalStatus("done")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("ready")).toBe(false);
  });

  it("exposes a complete transition map", () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([
      "backlog",
      "blocked",
      "cancelled",
      "done",
      "in_progress",
      "in_review",
      "ready",
    ]);
  });
});

describe("ticket id formatting", () => {
  it("zero-pads to four digits", () => {
    expect(formatTicketId(1)).toBe("WB-0001");
    expect(formatTicketId(42)).toBe("WB-0042");
    expect(formatTicketId(1234)).toBe("WB-1234");
  });
});

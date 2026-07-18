/**
 * Tests for the `workboard-dashboard` command: it must resolve the bundled
 * dashboard server, spawn it pointed at <cwd>/.pi/workboard on the fixed port
 * 8777 (restarting any prior instance), mark the invoking session's footer
 * with a "wbdash running" status, and open the browser — all without the test
 * actually launching a server or browser (child_process is mocked).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn((..._args: any[]) => ({ pid: 4242, unref: () => {} })),
}));
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../pi/register-commands.js";

function mockPi() {
  const handlers = new Map<string, { description: string; handler: Function }>();
  const pi = {
    registerCommand: (name: string, def: { description: string; handler: Function }) => {
      handlers.set(name, def);
    },
  } as unknown as ExtensionAPI;
  return { pi, handlers };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "wb-dash-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const STUB_CTX = {
  ticketService: {} as any,
  lifecycle: {} as any,
  selection: {} as any,
  sessionActive: {} as any,
};

describe("workboard-dashboard command", () => {
  it("spawns the bundled dashboard server on the fixed port 8777, sets the per-session wbdash status, and opens the browser", async () => {
    const { pi, handlers } = mockPi();
    registerCommands(pi, STUB_CTX);

    const notifications: string[] = [];
    const statuses: Record<string, string> = {};
    const c = {
      cwd: root,
      ui: {
        notify: (msg: string) => notifications.push(msg),
        setStatus: (key: string, text: string) => {
          statuses[key] = text;
        },
      },
    } as any;

    const def = handlers.get("workboard-dashboard");
    expect(def).toBeDefined();
    await def!.handler("", c);

    // Server spawn: node <abs path to dashboard/server.mjs>, env has WORKBOARD_DIR + fixed PORT 8777.
    const serverCall = spawnMock.mock.calls.find((call) => {
      const file = call[1] as string[];
      return Array.isArray(file) && file[0]?.endsWith("dashboard/server.mjs");
    });
    expect(serverCall).toBeDefined();
    const opts = serverCall![2] as any;
    const env = opts.env as NodeJS.ProcessEnv;
    expect(env.WORKBOARD_DIR).toBe(path.join(root, ".pi", "workboard"));
    expect(Number(env.PORT)).toBe(8777);

    // The wbdash footer status is set on THIS session only.
    expect(statuses.wbdash).toMatch(/^running · http:\/\/localhost:8777\/$/);

    // Browser open spawn happened (open on macOS / xdg-open on linux / cmd on win).
    expect(spawnMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    // User is told the URL.
    expect(notifications[0]).toMatch(/http:\/\/localhost:8777\//);
    expect(notifications[0]).toMatch(/server pid 4242/);
  });
});

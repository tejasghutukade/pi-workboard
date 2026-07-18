#!/usr/bin/env node
/**
 * Minimal live workboard dashboard (zero dependencies).
 *
 * Reads the real ticket JSON files from the workboard directory and serves a
 * static page that polls for changes. Nothing is written back — this is a
 * read-only viewer.
 *
 * Workboard dir resolution (first match wins):
 *   1. WORKBOARD_DIR env var
 *   2. first CLI arg
 *   3. <cwd>/.pi/workboard
 *
 * Run:
 *   npm run dashboard                      # serves ./pi/workboard of cwd
 *   WORKBOARD_DIR=/path/to/.pi/workboard npm run dashboard
 */

import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKBOARD_DIR =
  process.env.WORKBOARD_DIR ||
  process.argv[2] ||
  path.join(process.cwd(), ".pi", "workboard");

/**
 * Derive a human-readable project name from the workboard directory.
 * The workboard lives at <project>/.pi/workboard, so the project folder is
 * two levels up. Fall back to the workboard dir's own parent if the layout
 * differs.
 */
function projectName() {
  try {
    const normalized = path.resolve(WORKBOARD_DIR);
    const parent = path.dirname(normalized); // <project>/.pi
    const grandparent = path.dirname(parent); // <project>
    if (path.basename(parent).toLowerCase() === ".pi" && grandparent !== parent) {
      return path.basename(grandparent);
    }
    return path.basename(parent);
  } catch {
    return "Workboard";
  }
}

const PROJECT_NAME = projectName();

const PORT = Number(process.env.PORT) || 8777;

/** How many Done tickets the dashboard shows. Newest completed first. */
const MAX_DONE_VISIBLE = 10;

function doneKey(t) {
  return t.completedAt || t.updatedAt || t.createdAt || "";
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function getBoard() {
  const board = (await readJson(path.join(WORKBOARD_DIR, "board.json"))) || {
    nextTicketNumber: 1,
  };

  const ticketsDir = path.join(WORKBOARD_DIR, "tickets");
  let names = [];
  try {
    names = await fs.readdir(ticketsDir);
  } catch {
    names = [];
  }

  const tickets = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const t = await readJson(path.join(ticketsDir, name));
    if (t && t.id) tickets.push(t);
  }
  tickets.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const allDone = tickets.filter((t) => t.status === "done");
  allDone.sort((a, b) => doneKey(b).localeCompare(doneKey(a)));
  const doneVisible = allDone.slice(0, MAX_DONE_VISIBLE);

  return { board, tickets, doneTotal: allDone.length, done: doneVisible };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/board") {
    try {
      const data = await getBoard();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ project: PROJECT_NAME, ...data }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url.pathname.startsWith("/api/ticket/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/ticket/".length));
    const board = await getBoard();
    const t = board.tickets.find((x) => x.id === id);
    if (!t) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ticket not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(t));
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    try {
      const html = await fs.readFile(path.join(__dirname, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("index.html not found");
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Workboard live dashboard (${PROJECT_NAME}): http://localhost:${PORT}`);
  console.log(`Reading tickets from: ${WORKBOARD_DIR}`);
});

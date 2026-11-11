const http = require("node:http");
const { timingSafeEqual, createHash } = require("node:crypto");
const { readFileSync, mkdirSync } = require("node:fs");
const { resolve, dirname, join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { statuses } = require("./model");

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function createServer({ databasePath, password }) {
  if (!password || password.length < 24) throw new Error("Set OPSLEDGER_PASSWORD to at least 24 characters.");
  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, owner TEXT NOT NULL,
      due TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Open', 'In progress', 'Done'))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY, message TEXT NOT NULL, at TEXT NOT NULL
    ) STRICT;
  `);
  const expected = digest("Basic " + Buffer.from("opsledger:" + password).toString("base64"));
  const staticFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
    ["/model.js", ["model.js", "text/javascript; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]]
  ].map(([url, [file, type]]) => [url, { type, bytes: readFileSync(join(__dirname, file)) }]));

  function workspace() {
    return {
      items: db.prepare("SELECT * FROM items ORDER BY id DESC").all(),
      activity: db.prepare("SELECT message, at FROM activity ORDER BY id DESC LIMIT 12").all()
    };
  }

  function transaction(change) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const message = change();
      if (message) db.prepare("INSERT INTO activity (message, at) VALUES (?, ?)").run(message, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(payload));
    };
    try {
      const path = req.url.split("?")[0];
      if (req.method === "GET" && path === "/healthz") {
        db.prepare("SELECT id FROM items LIMIT 1").get();
        return send(200, { status: "ok" });
      }
      if (!timingSafeEqual(digest(req.headers.authorization || ""), expected)) {
        res.setHeader("WWW-Authenticate", 'Basic realm="OpsLedger", charset="UTF-8"');
        return send(401, { error: "Sign in to access this workspace." });
      }
      if (req.method === "GET" && staticFiles.has(path)) {
        const { type, bytes } = staticFiles.get(path);
        res.writeHead(200, { "Content-Type": type });
        return res.end(bytes);
      }
      if (req.method === "GET" && path === "/api/workspace") return send(200, workspace());
      const match = /^\/api\/items\/([1-9][0-9]{0,14})$/.exec(path);
      const creating = req.method === "POST" && path === "/api/items";
      const updating = req.method === "PATCH" && match;
      if (!creating && !updating) return send(404, { error: "Route not found." });

      if (req.headers["x-opsledger-request"] !== "1" || req.headers["sec-fetch-site"] === "cross-site") {
        return send(403, { error: "Request origin is not allowed." });
      }
      if (req.headers["content-type"] !== "application/json") return send(415, { error: "Expected JSON." });
      let data = "";
      req.setEncoding("utf8");
      for await (const chunk of req) {
        data += chunk;
        if (Buffer.byteLength(data) > 4096) {
          res.setHeader("Connection", "close");
          send(413, { error: "Request is too large." });
          return;
        }
      }
      let body;
      try { body = JSON.parse(data); } catch { return send(400, { error: "Invalid JSON." }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return send(400, { error: "Expected a JSON object." });
      if (creating) {
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const owner = typeof body.owner === "string" ? body.owner.trim() : "";
        const due = body.due;
        if (!title || title.length > 90 || !owner || owner.length > 45 || !validDate(due)) {
          return send(400, { error: "Enter a title, owner, and valid due date." });
        }
        transaction(() => {
          db.prepare("INSERT INTO items (title, owner, due, status) VALUES (?, ?, ?, 'Open')").run(title, owner, due);
          return title + " was added to the queue.";
        });
        return send(201, workspace());
      }
      if (!statuses.includes(body.status)) return send(400, { error: "Invalid status." });
      let found;
      transaction(() => {
        found = db.prepare("SELECT title, status FROM items WHERE id = ?").get(Number(match[1]));
        if (!found || found.status === body.status) return;
        db.prepare("UPDATE items SET status = ? WHERE id = ?").run(body.status, Number(match[1]));
        return found.title + " moved from " + found.status + " to " + body.status + ".";
      });
      if (!found) return send(404, { error: "Work item not found." });
      return send(200, workspace());
    } catch (error) {
      console.error("OpsLedger request failed:", error.message);
      if (!res.headersSent && !res.destroyed) send(500, { error: "The workspace is temporarily unavailable." });
    }
  });
  server.once("close", () => db.close());
  return server;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

if (require.main === module) {
  const server = createServer({
    databasePath: process.env.OPSLEDGER_DB || "data/opsledger.sqlite",
    password: process.env.OPSLEDGER_PASSWORD
  });
  const port = Number(process.env.PORT || "8080");
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () => console.log("OpsLedger listening on " + host + ":" + port));
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close());
}

module.exports = { createServer };

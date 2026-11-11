const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createServer } = require("./server");

test("serves an authenticated workspace and persists writes across restarts", async t => {
  const directory = mkdtempSync(join(tmpdir(), "opsledger-"));
  const password = "integration-test-password-only";
  let server;
  async function start() {
    server = createServer({ databasePath: join(directory, "ledger.sqlite"), password });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return "http://127.0.0.1:" + server.address().port;
  }
  async function stop() {
    if (server?.listening) {
      const closed = once(server, "close");
      server.close();
      await closed;
    }
  }
  t.after(async () => {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  });

  let base = await start();
  const auth = { Authorization: "Basic " + Buffer.from("opsledger:" + password).toString("base64") };
  const headers = { ...auth, "Content-Type": "application/json", "X-OpsLedger-Request": "1" };
  const item = { title: "Reconcile invoices", owner: "Noor", due: "2028-02-29" };
  const post = (body, requestHeaders = headers) => fetch(base + "/api/items", {
    method: "POST", headers: requestHeaders, body: JSON.stringify(body)
  });

  assert.equal((await fetch(base + "/healthz")).status, 200);
  assert.equal((await fetch(base + "/api/workspace")).status, 401);
  const page = await fetch(base, { headers: auth });
  assert.match(await page.text(), /Operations overview/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal((await fetch(base + "/server.js", { headers: auth })).status, 404);
  assert.equal((await post(item, { ...headers, "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await post({ ...item, due: "2028-02-30" })).status, 400);
  assert.equal((await post({ ...item, title: "x".repeat(5000) })).status, 413);

  const created = await post(item);
  assert.equal(created.status, 201);
  const { items } = await created.json();
  assert.equal(items[0].status, "Open");
  async function complete() {
    return fetch(base + "/api/items/" + items[0].id, {
      method: "PATCH", headers, body: JSON.stringify({ status: "Done" })
    });
  }
  assert.equal((await complete()).status, 200);
  assert.equal((await (await complete()).json()).activity.length, 2);

  await stop();
  base = await start();
  const persisted = await (await fetch(base + "/api/workspace", { headers: auth })).json();
  assert.equal(persisted.items[0].status, "Done");
  assert.equal(persisted.activity.length, 2);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { localDate, overdue, filterItems, summarize } = require("./model.js");

const today = "2026-11-11";
const items = [
  { title: "Prepare invoice", owner: "Noor", status: "Open", due: "2026-11-10" },
  { title: "Review invoice", owner: "Sam", status: "Done", due: "2026-11-10" },
  { title: "Update inventory", owner: "Sam", status: "In progress", due: today }
];

test("counts overdue active work and excludes items due today", () => {
  assert.deepEqual(summarize(items, today), { active: 2, overdue: 1, done: 1 });
  assert.equal(overdue({ status: "Open", due: "" }, today), false);
});

test("combines status and case-insensitive title or owner search", () => {
  assert.deepEqual(filterItems(items, "Done", " INVOICE "), [items[1]]);
  assert.deepEqual(filterItems(items, "", "sam"), items.slice(1));
});

test("formats the local calendar date", () => {
  assert.equal(localDate(new Date(2026, 0, 3, 23, 59)), "2026-01-03");
});

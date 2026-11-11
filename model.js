(function (root) {
  const statuses = ["Open", "In progress", "Done"];
  function localDate(date = new Date()) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map(part => String(part).padStart(2, "0")).join("-");
  }
  function overdue(item, today) {
    return item.status !== "Done" && Boolean(item.due) && item.due < today;
  }
  function filterItems(items, status, query) {
    const search = query.trim().toLowerCase();
    return items.filter(item => (!status || item.status === status)
      && [item.title, item.owner].some(value => value.toLowerCase().includes(search)));
  }
  function summarize(items, today) {
    return {
      active: items.filter(item => item.status !== "Done").length,
      overdue: items.filter(item => overdue(item, today)).length,
      done: items.filter(item => item.status === "Done").length
    };
  }
  const model = { statuses, localDate, overdue, filterItems, summarize };
  if (typeof module === "object") module.exports = model;
  else root.OpsLedger = model;
})(globalThis);

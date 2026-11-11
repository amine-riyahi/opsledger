const { statuses, localDate, overdue, filterItems, summarize } = globalThis.OpsLedger;
const byId = id => document.getElementById(id);
const key = "opsledger.workspace.v1";
const relativeDate = offset => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localDate(date);
};

function loadWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && Array.isArray(saved.items) && Array.isArray(saved.activity)) return saved;
  } catch {}
  return {
    items: [
      { title: "Reconcile supplier invoices", owner: "Noor", due: relativeDate(-2), status: "Open" },
      { title: "Review weekly inventory", owner: "Sam", due: relativeDate(2), status: "In progress" },
      { title: "Confirm dispatch schedule", owner: "Maya", due: relativeDate(1), status: "Open" },
      { title: "Send monthly operations report", owner: "Noor", due: relativeDate(-1), status: "Done" }
    ],
    activity: []
  };
}

const localDemo = location.protocol === "file:";
let workspace = localDemo ? loadWorkspace() : { items: [], activity: [] };
let busy = false;

async function request(path, method = "GET", payload) {
  const response = await fetch(path, {
    method,
    ...(payload && {
      headers: { "Content-Type": "application/json", "X-OpsLedger-Request": "1" },
      body: JSON.stringify(payload)
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The workspace is unavailable.");
  return result;
}

async function save(path, method, payload, onSuccess) {
  busy = true;
  render();
  try {
    workspace = await request(path, method, payload);
    onSuccess();
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    busy = false;
    render();
  }
}
const filter = byId("filter");
const search = byId("search");
const form = byId("new-item");
const feedback = byId("feedback");
const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function element(tag, content, className = "") {
  const node = document.createElement(tag);
  node.textContent = content;
  node.className = className;
  return node;
}

function record(message) {
  workspace.activity.unshift({ message, at: new Date().toISOString() });
  workspace.activity = workspace.activity.slice(0, 12);
  feedback.textContent = message;
  try {
    localStorage.setItem(key, JSON.stringify(workspace));
  } catch {
    feedback.textContent += " Browser storage is unavailable. Changes last until you close or reload this page.";
  }
  render();
}

function render() {
  form.querySelector("button").disabled = busy;
  const today = localDate();
  for (const [name, count] of Object.entries(summarize(workspace.items, today))) {
    byId(name).textContent = count;
  }
  const rows = filterItems(workspace.items, filter.value, search.value).map(item => {
    const row = element("li", "");
    const label = element("div", "");
    const detail = element("span", item.owner + " � Due " + item.due, "detail");
    if (overdue(item, today)) detail.append(" � ", element("span", "Overdue", "late"));
    label.append(element("strong", item.title), detail);
    const select = element("select", "");
    select.setAttribute("aria-label", "Status for " + item.title);
    for (const status of statuses) select.add(new Option(status, status));
    select.value = item.status;
    if (!localDemo) select.id = "item-status-" + item.id;
    select.disabled = busy;
    select.addEventListener("change", async () => {
      if (!localDemo) {
        await save("/api/items/" + item.id, "PATCH", { status: select.value }, () => {
          feedback.textContent = item.title + " was updated.";
        });
        (byId("item-status-" + item.id) || filter).focus();
        return;
      }
      const previous = item.status;
      item.status = select.value;
      record(item.title + " moved from " + previous + " to " + item.status + ".");
      const replacement = [...byId("queue").querySelectorAll("select")]
        .find(control => control.getAttribute("aria-label") === select.getAttribute("aria-label"));
      (replacement || filter).focus();
    });
    row.append(label, select);
    return row;
  });
  byId("queue").replaceChildren(...(rows.length ? rows : [element("li", "No matching work items.")]));
  const activity = workspace.activity.map(entry => {
    const row = element("li", entry.message);
    const time = element("time", dateLabel.format(new Date(entry.at)));
    time.dateTime = entry.at;
    row.append(time);
    return row;
  });
  byId("activity").replaceChildren(...(activity.length ? activity : [element("li", "Status changes and new work will appear here.")]));
}

for (const status of statuses) filter.add(new Option(status, status));
filter.addEventListener("change", render);
search.addEventListener("input", render);
form.addEventListener("submit", async event => {
  event.preventDefault();
  const values = new FormData(form);
  const title = values.get("title").trim();
  const owner = values.get("owner").trim();
  if (!title || !owner) {
    feedback.textContent = "Enter a title and owner.";
    form.elements[title ? "owner" : "title"].focus();
    return;
  }
  if (busy) return;
  const due = values.get("due");
  if (!localDemo) {
    await save("/api/items", "POST", { title, owner, due }, () => {
      form.reset();
      filter.value = "";
      search.value = "";
      feedback.textContent = title + " was added to the queue.";
    });
    form.elements.title.focus();
    return;
  }
  workspace.items.unshift({ title, owner, due, status: "Open" });
  form.reset();
  filter.value = "";
  search.value = "";
  record(title + " was added to the queue.");
  form.elements.title.focus();
});

render();

if (!localDemo) {
  byId("workspace-mode").textContent = "Shared workspace";
  busy = true;
  render();
  request("/api/workspace").then(result => {
    workspace = result;
    busy = false;
    render();
  }).catch(error => {
    feedback.textContent = error.message + " Reload to retry.";
  });
}

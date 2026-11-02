// Projects, as Orca has them: a project is a folder on one machine, a git
// repository or any folder, kept in a list until it's removed. A repo a space
// opens in joins the list by itself; any folder can be added. A space belongs
// to its repo's project, else to the project whose folder holds where it is now
// (the deepest one). Pure: no herdr imports, so node can test it.

// A repo's folder from git's common dir: "/x/app/.git" -> "/x/app"; a bare
// repo ("/x/app.git") is its own folder.
export function repoRoot(commonDir) {
  const dir = String(commonDir ?? "").replace(/[\\/]+$/, "");
  return /[\\/]\.git$/.test(dir) ? dir.slice(0, -5) : dir;
}

// A path as compared: "/" for "\", no trailing slash, and on a Windows path
// (a drive letter) lowercased, since Windows ignores case.
export function norm(path) {
  let p = String(path ?? "").replace(/\\/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return /^[A-Za-z]:/.test(p) ? p.toLowerCase() : p;
}

export const inside = (path, root) => {
  const p = norm(path), r = norm(root);
  return Boolean(p && r) && (p === r || p.startsWith(r.endsWith("/") ? r : r + "/"));
};

export const baseName = (path) => String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(path ?? "");

// A machine's key in the store: "" for this computer.
export const machineKey = (machine) => machine ?? "";

// The store: { [machineKey]: { list: [{ id, root, name, auto }], removed: [root] } }.
export const emptyStore = () => ({});
const entry = (store, machine) => store?.[machineKey(machine)] ?? { list: [], removed: [] };
export const projectList = (store, machine) => entry(store, machine).list;

const newId = (root) => "p" + [...norm(root)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261).toString(36);

// The store with a project added (no change when its folder is listed already).
// `auto`: found from a repo a space opened in; one the person removed stays out.
export function addProject(store, machine, root, { name, auto = false } = {}) {
  const e = entry(store, machine);
  if (e.list.some((p) => norm(p.root) === norm(root))) return store;
  if (auto && e.removed.some((r) => norm(r) === norm(root))) return store;
  const list = [...e.list, { id: newId(root), root, name: name || baseName(root), auto }];
  const removed = auto ? e.removed : e.removed.filter((r) => norm(r) !== norm(root));
  return { ...store, [machineKey(machine)]: { list, removed } };
}

// Removed from the list; a repo's folder is remembered so it isn't added back by itself.
export function removeProject(store, machine, id) {
  const e = entry(store, machine), p = e.list.find((x) => x.id === id);
  if (!p) return store;
  return { ...store, [machineKey(machine)]: { list: e.list.filter((x) => x.id !== id), removed: [...e.removed.filter((r) => norm(r) !== norm(p.root)), p.root] } };
}

export function renameProject(store, machine, id, name) {
  const e = entry(store, machine);
  return { ...store, [machineKey(machine)]: { ...e, list: e.list.map((p) => (p.id === id ? { ...p, name: name || baseName(p.root) } : p)) } };
}

// Which project a space belongs to: its repo's, else the deepest folder holding it.
export function projectFor(list, { place, repo }) {
  if (repo) {
    const own = list.find((p) => norm(p.root) === norm(repo));
    if (own) return own;
  }
  let best = null;
  for (const p of list) if (inside(place, p.root) && (!best || norm(p.root).length > norm(best.root).length)) best = p;
  return best;
}

// rows: [{ w, i, g, place }] of one machine in Herdr's space order; g the space's
// git info ({ name, repo: JSON [machine, commonDir], linked }) or null.
// Returns { projects: [{ ...project, rows }], loose } in the list's order, empty
// projects included; within a project its main checkouts come before worktrees
// (`worktree: true`).
export function groupRows(list, rows) {
  const by = new Map(list.map((p) => [p.id, { main: [], linked: [] }])), loose = [];
  for (const r of rows) {
    const repo = r.g?.repo ? repoRoot(JSON.parse(r.g.repo)[1]) : null;
    const p = projectFor(list, { place: r.place, repo });
    if (!p) { loose.push(r); continue; }
    by.get(p.id)[r.g?.linked ? "linked" : "main"].push({ ...r, worktree: Boolean(r.g?.linked) });
  }
  return { projects: list.map((p) => ({ ...p, rows: [...by.get(p.id).main, ...by.get(p.id).linked] })), loose };
}

// The repos the rows are in that the list doesn't have yet: [{ root, name }].
export function reposToAdd(store, machine, rows) {
  const e = entry(store, machine), seen = new Set(), out = [];
  for (const r of rows) {
    if (!r.g?.repo) continue;
    const root = repoRoot(JSON.parse(r.g.repo)[1]), k = norm(root);
    if (seen.has(k) || e.list.some((p) => norm(p.root) === k) || e.removed.some((x) => norm(x) === k)) continue;
    seen.add(k);
    out.push({ root, name: r.g.name });
  }
  return out;
}

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// The most urgent status among a project's spaces, as Herdr ranks them.
export function urgent(statuses) {
  let best = null;
  for (const s of statuses) if ((RANK[s] ?? 0) > (RANK[best] ?? 0)) best = s;
  return best;
}

// Projects from the space-folders mod's file (~/.config/herdr-space-folders.json):
// each folder with a start path becomes a project, "~" expanded with `home`.
export function fromSpaceFolders(text, home) {
  try {
    const d = JSON.parse(text);
    return (d.list ?? []).filter((f) => f.path).map((f) => ({ root: f.path.replace(/^~(?=$|[\\/])/, home), name: f.name }));
  } catch { return []; }
}

// Spaces grouped by project, as Orca does: a project is one git repository on
// one machine (a repo's checkouts on two machines are two projects), with its
// main checkout's spaces first and its worktrees' after. Spaces in no repo stay
// loose. Pure: no herdr imports, so node can test it.

// A repo's folder from git's common dir: "/x/app/.git" -> "/x/app"; a bare
// repo ("/x/app.git") is its own folder.
export function repoRoot(commonDir) {
  const dir = String(commonDir ?? "").replace(/[\\/]+$/, "");
  return /[\\/]\.git$/.test(dir) ? dir.slice(0, -5) : dir;
}

// What a project's fold, icon and order are kept under: its machine and repo.
export const projectKey = (g) => g?.repo ?? null;

// rows: [{ w, i, g }] in Herdr's space order, g the space's git info
// ({ name, repo: JSON [machine, commonDir], linked, ... }) or null.
// Returns { projects: [{ key, name, machine, root, rows, linked }], loose: rows }
// with projects in the order their first space appears. A row inside a project
// gets `worktree: true` when it's a linked checkout.
export function projectsOf(rows) {
  const projects = new Map(), loose = [];
  for (const r of rows) {
    const key = projectKey(r.g);
    if (!key) { loose.push(r); continue; }
    if (!projects.has(key)) {
      const [machine, common] = JSON.parse(key);
      projects.set(key, { key, name: r.g.name, machine: machine ?? null, root: repoRoot(common), main: [], linked: [] });
    }
    projects.get(key)[r.g.linked ? "linked" : "main"].push({ ...r, worktree: Boolean(r.g.linked) });
  }
  return {
    projects: [...projects.values()].map(({ main, linked, ...p }) => ({ ...p, rows: [...main, ...linked] })),
    loose,
  };
}

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// The most urgent status among a project's spaces, as Herdr ranks them.
export function urgent(statuses) {
  let best = null;
  for (const s of statuses) if ((RANK[s] ?? 0) > (RANK[best] ?? 0)) best = s;
  return best;
}

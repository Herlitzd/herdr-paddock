// node tests/projects.test.mjs: grouping spaces by project.
import { projectsOf, repoRoot, urgent } from "../mods/spaces-plus/projects.js";

let bad = 0, count = 0;
const check = (what, got, want) => {
  count++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { bad++; console.log(`FAIL ${what}:\n  got  ${g}\n  want ${w}`); }
};

check("repo root", repoRoot("/home/dev/app/.git"), "/home/dev/app");
check("repo root, Windows", repoRoot("C:/work/app/.git"), "C:/work/app");
check("repo root, backslashes", repoRoot("C:\\work\\app\\.git\\"), "C:\\work\\app");
check("bare repo", repoRoot("/srv/app.git"), "/srv/app.git");

const git = (machine, dir, linked = false, name = "app") => ({ name, repo: JSON.stringify([machine, dir]), linked });
const row = (i, name, g, status = "idle") => ({ w: { id: `s${i}`, name, status }, i, g });
const rows = [
  row(0, "notes", null),
  row(1, "fix-login", git(null, "/w/app/.git", true)),
  row(2, "app", git(null, "/w/app/.git")),
  row(3, "api", git(null, "/w/api/.git", false, "api")),
  row(4, "app on vps", git("vps", "/home/u/app/.git")),
];
const { projects, loose } = projectsOf(rows);
check("projects in first-seen order", projects.map((p) => p.name + "@" + (p.machine ?? "here")), ["app@here", "api@here", "app@vps"]);
check("main checkout before worktrees", projects[0].rows.map((r) => r.w.name), ["app", "fix-login"]);
check("worktree flag", projects[0].rows.map((r) => r.worktree), [false, true]);
check("root", projects[0].root, "/w/app");
check("same repo on two machines is two projects", projects.filter((p) => p.name === "app").length, 2);
check("loose spaces", loose.map((r) => r.w.name), ["notes"]);
check("empty", projectsOf([]), { projects: [], loose: [] });

check("urgent", urgent(["idle", "working", "done"]), "done");
check("urgent blocked", urgent(["done", "blocked"]), "blocked");
check("urgent none", urgent([undefined, null]), null);

console.log(bad ? `${bad} of ${count} failed` : `all ${count} passed`);
process.exit(bad ? 1 : 0);

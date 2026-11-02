// node tests/projects.test.mjs: the project list and grouping spaces into it.
import { repoRoot, norm, inside, addProject, removeProject, renameProject, editProject, reorderProject, placeSpace, placedOf, projectList, projectFor, groupRows, reposToAdd, urgent, fromSpaceFolders } from "../mods/spaces-plus/projects.js";

let bad = 0, count = 0;
const check = (what, got, want) => {
  count++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { bad++; console.log(`FAIL ${what}:\n  got  ${g}\n  want ${w}`); }
};

// Paths
check("repo root", repoRoot("/home/dev/app/.git"), "/home/dev/app");
check("repo root, Windows", repoRoot("C:/work/app/.git"), "C:/work/app");
check("repo root, backslashes", repoRoot("C:\\work\\app\\.git\\"), "C:\\work\\app");
check("bare repo", repoRoot("/srv/app.git"), "/srv/app.git");
check("norm Windows", norm("C:\\Work\\App\\"), "c:/work/app");
check("norm posix keeps case", norm("/Home/Dev/"), "/Home/Dev");
check("inside", inside("/w/app/src", "/w/app"), true);
check("inside itself", inside("/w/app", "/w/app"), true);
check("not a sibling", inside("/w/app2", "/w/app"), false);
check("inside, Windows mixed", inside("c:\\work\\APP\\src", "C:/Work/app"), true);
check("posix is case-sensitive", inside("/w/App/src", "/w/app"), false);
check("inside root /", inside("/w", "/"), true);

// The list
let s = {};
s = addProject(s, null, "/w/app", { name: "app", auto: true });
s = addProject(s, null, "/w/notes");
s = addProject(s, "vps", "/home/u/app", { auto: true });
check("added", projectList(s, null).map((p) => [p.name, p.auto]), [["app", true], ["notes", false]]);
check("per machine", projectList(s, "vps").map((p) => p.root), ["/home/u/app"]);
check("no duplicate", projectList(addProject(s, null, "/w/app/"), null).length, 2);
const app = projectList(s, null)[0];
check("renamed", projectList(renameProject(s, null, app.id, "Web"), null)[0].name, "Web");
check("rename to empty goes back to the folder", projectList(renameProject(s, null, app.id, ""), null)[0].name, "app");
const gone = removeProject(s, null, app.id);
check("removed", projectList(gone, null).map((p) => p.name), ["notes"]);
check("a removed repo isn't added back by itself", projectList(addProject(gone, null, "/w/app", { auto: true }), null).length, 1);
check("added back by hand", projectList(addProject(gone, null, "/w/app"), null).length, 2);
check("other machine untouched", projectList(gone, "vps").length, 1);

// Belonging
const list = [
  { id: "a", root: "/w/app" },
  { id: "n", root: "/w" },
  { id: "b", root: "/w/app/packages/b" },
];
check("deepest folder wins", projectFor(list, { place: "/w/app/packages/b/src" })?.id, "b");
check("outer folder", projectFor(list, { place: "/w/other" })?.id, "n");
check("repo wins over folder", projectFor(list, { place: "/elsewhere/wt", repo: "/w/app" })?.id, "a");
check("none", projectFor(list, { place: "/tmp" }), null);

const git = (dir, linked = false, name = "app") => ({ name, repo: JSON.stringify([null, dir]), linked });
const row = (i, name, place, g = null, status = "idle") => ({ w: { id: `s${i}`, name, status }, i, g, place });
const rows = [
  row(0, "scratch", "/tmp/x"),
  row(1, "fix-login", "/wt/app/fix-login", git("/w/app/.git", true)),
  row(2, "app", "/w/app", git("/w/app/.git")),
  row(3, "notes", "/w/notes"),
];
const projects = [{ id: "a", root: "/w/app", name: "app" }, { id: "n", root: "/w/notes", name: "notes" }, { id: "e", root: "/w/empty", name: "empty" }];
const g = groupRows(projects, rows);
check("grouped in list order, empty kept", g.projects.map((p) => [p.name, p.rows.map((r) => r.w.name)]), [["app", ["app", "fix-login"]], ["notes", ["notes"]], ["empty", []]]);
check("worktree flag", g.projects[0].rows.map((r) => r.worktree), [false, true]);
check("loose", g.loose.map((r) => r.w.name), ["scratch"]);

// Dragged in and out
check("dragged into notes", groupRows(projects, rows, { s0: "n" }).projects[1].rows.map((r) => r.w.name), ["scratch", "notes"]);
check("dragged out of app", groupRows(projects, rows, { s2: "" }).loose.map((r) => r.w.name), ["scratch", "app"]);
check("dragged to a project that's gone", groupRows(projects, rows, { s0: "zzz" }).loose.map((r) => r.w.name), ["scratch"]);

let d = addProject(addProject({}, null, "/w/app"), null, "/w/notes");
const [pa, pn] = projectList(d, null);
d = placeSpace(d, null, "s0", pn.id);
check("place into", placedOf(d, null), { s0: pn.id });
check("place out of a dragged-in project forgets it", placedOf(placeSpace(d, null, "s0", null), null), {});
check("place out of its natural project keeps it out", placedOf(placeSpace(d, null, "s2", null, { natural: pa.id }), null), { s0: pn.id, s2: "" });
check("place back into its natural project forgets the drag", placedOf(placeSpace(placeSpace(d, null, "s2", null, { natural: pa.id }), null, "s2", pa.id, { natural: pa.id }), null), { s0: pn.id });
check("place into a missing project does nothing", placeSpace(d, null, "s9", "zzz"), d);
check("removing a project forgets spaces dragged into it", placedOf(removeProject(d, null, pn.id), null), {});

// Edit, order
check("edit name and folder", projectList(editProject(d, null, pa.id, { name: "Web", root: "/w/web" }), null)[0], { ...pa, root: "/w/web", name: "Web" });
check("edit, empty name follows the new folder", projectList(editProject(d, null, pa.id, { name: "", root: "/w/web" }), null)[0].name, "web");
let o = addProject(d, null, "/w/c");
const pc = projectList(o, null)[2];
check("move down", projectList(reorderProject(o, null, pa.id, pc.id), null).map((p) => p.name), ["notes", "c", "app"]);
check("move up", projectList(reorderProject(o, null, pc.id, pa.id), null).map((p) => p.name), ["c", "app", "notes"]);
check("move onto itself", reorderProject(o, null, pa.id, pa.id), o);

check("repos to add", reposToAdd({}, null, rows), [{ root: "/w/app", name: "app" }]);
check("repos already listed", reposToAdd(addProject({}, null, "/w/app"), null, rows), []);
check("repos removed", reposToAdd(removeProject(addProject({}, null, "/w/app"), null, projectList(addProject({}, null, "/w/app"), null)[0].id), null, rows), []);

check("urgent", urgent(["idle", "working", "done"]), "done");
check("urgent blocked", urgent(["done", "blocked"]), "blocked");
check("urgent none", urgent([undefined, null]), null);

const sf = JSON.stringify({ list: [{ id: "f1", name: "Work", path: "~\\code\\work" }, { id: "f2", name: "No path" }, { id: "f3", name: "Abs", path: "/srv/x" }] });
check("from space-folders", fromSpaceFolders(sf, "C:\\Users\\dev"), [{ root: "C:\\Users\\dev\\code\\work", name: "Work" }, { root: "/srv/x", name: "Abs" }]);
check("from a broken file", fromSpaceFolders("{", "/home/dev"), []);

console.log(bad ? `${bad} of ${count} failed` : `all ${count} passed`);
process.exit(bad ? 1 : 0);

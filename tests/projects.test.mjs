// node tests/projects.test.mjs: the project list and grouping spaces into it.
import { repoRoot, norm, inside, addProject, removeProject, editProject, taken, prunePlaced, reorderProject, placeSpace, placedOf, projectList, projectFor, groupRows, reposToAdd, urgent, fromSpaceFolders } from "../mods/paddock/projects.js";
import { byParent, tree, kidStatus, duration } from "../mods/paddock/agents-data.js";

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
check("renamed", projectList(editProject(s, null, app.id, { name: "Web" }), null)[0].name, "Web");
check("rename to empty goes back to the folder", projectList(editProject(s, null, app.id, { name: "" }), null)[0].name, "app");
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

// Edit: a folder another project has is refused; the old folder is remembered.
const twoP = addProject(addProject({}, null, "/w/one"), null, "/w/two");
const [p1, p2] = projectList(twoP, null);
check("edit onto another project's folder is refused", editProject(twoP, null, p1.id, { root: "/w/two" }), twoP);
check("taken", [taken(twoP, null, "/w/two/"), taken(twoP, null, "/w/two", p2.id), taken(twoP, null, "/w/three")], [true, false, false]);
const moved = editProject(twoP, null, p1.id, { root: "/w/uno" });
check("moved folder remembered", moved[""].removed, ["/w/one"]);
check("the old repo isn't added back by itself", projectList(addProject(moved, null, "/w/one", { auto: true }), null).length, 2);
check("moving back clears it", editProject(moved, null, p1.id, { root: "/w/one" })[""].removed, ["/w/uno"]);
// Ids stay unique when a folder comes back to a listed project's old id.
const back = addProject(moved, null, "/w/one");
check("unique ids", new Set(projectList(back, null).map((p) => p.id)).size, 3);

// Pruning placements of spaces that are gone.
let pl = placeSpace(placeSpace(twoP, null, "s1", p1.id), null, "s2", p2.id);
check("prune keeps live", placedOf(prunePlaced(pl, null, new Set(["s1", "s2"])), null), { s1: p1.id, s2: p2.id });
check("prune drops gone", placedOf(prunePlaced(pl, null, new Set(["s1"])), null), { s1: p1.id });
check("prune with nothing gone is the same store", prunePlaced(pl, null, new Set(["s1", "s2"])), pl);

// Another machine: its own list, prefixed space ids, its repos.
let vps = addProject({}, "vps", "/home/u/app", { auto: true });
const pv = projectList(vps, "vps")[0];
vps = placeSpace(vps, "vps", "vps/sp1", pv.id);
check("remote placement by prefixed id", placedOf(vps, "vps"), { "vps/sp1": pv.id });
check("this computer untouched", projectList(vps, null), []);
const remoteRows = [{ w: { id: "vps/sp2", name: "app" }, i: 0, place: "/home/u/app/src", g: { name: "app", repo: JSON.stringify(["vps", "/home/u/app/.git"]), linked: false } }];
check("remote repo already listed", reposToAdd(vps, "vps", remoteRows), []);
check("remote row belongs", groupRows(projectList(vps, "vps"), remoteRows, placedOf(vps, "vps")).projects[0].rows.map((r) => r.w.id), ["vps/sp2"]);

// The agent rows' data.
const kidsOf = byParent([
  { address: "t2", parent: "t1", state: "live" },
  { address: "t3", parent: "t2", state: "live" },
  { address: "t4", parent: "t1", state: "finished" },
  { address: "t5", parent: "t1", state: "live" },
  { address: "t1", parent: "t3", state: "live" },
]);
check("sub-agent tree", tree(kidsOf, "t1").map((s) => [s.k.address, s.lines.join("")]), [["t2", "├"], ["t3", "│└"], ["t5", "└"]]);
check("kid status", ["error", "done", "working"].map((st) => kidStatus({ address: "x", status: st }, new Map())), ["blocked", "idle", "working"]);
check("kid status from agents()", kidStatus({ address: "x", status: "idle" }, new Map([["x", "blocked"]])), "blocked");
check("durations", [0, 59999, 60000, 3599999, 3600000, 86400000 * 2].map(duration), ["<1m", "<1m", "1m", "59m", "1h", "2d"]);

console.log(bad ? `${bad} of ${count} failed` : `all ${count} passed`);
process.exit(bad ? 1 : 0);

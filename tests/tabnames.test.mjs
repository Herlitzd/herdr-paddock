// node tests/tabnames.test.mjs: tabs named after their agent's session (Local patch: tab names).
import { tabNames } from "../mods/paddock/tabnames.js";

let bad = 0, count = 0;
const check = (what, got, want) => {
  count++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { bad++; console.log(`FAIL ${what}:\n  got  ${g}\n  want ${w}`); }
};

const claude = { key: "claude", name: "Claude Code" }, shell = { key: "bash", name: "bash", shell: true };
const sp = (...tabs) => [{ id: "s", tabs }];
const tab = (id, name, named = false) => ({ id, name, named });
const pane = (t, terminal, title, program = claude, app = "claude") => ({ tab: t, terminal, title, app, program });

check("unnamed tab takes the session",
  tabNames(sp(tab("a", "1")), [pane("a", "t1", "✳ Fix login redirect")], {}),
  { owners: { a: { name: "Fix login redirect", terminal: "t1" } }, renames: [{ id: "a", name: "Fix login redirect" }] });
check("no session yet: left alone",
  tabNames(sp(tab("a", "1")), [pane("a", "t1", "✳ Claude Code")], {}), { owners: {}, renames: [] });
check("a shell's title isn't a name",
  tabNames(sp(tab("a", "1")), [pane("a", "t1", "make build", shell, null)], {}), { owners: {}, renames: [] });
check("a tab someone named is theirs",
  tabNames(sp(tab("a", "PR #12", true)), [pane("a", "t1", "Fix login")], {}), { owners: {}, renames: [] });
check("our own name follows the session",
  tabNames(sp(tab("a", "Fix login", true)), [pane("a", "t1", "Fix login and logout")], { a: { name: "Fix login", terminal: "t1" } }),
  { owners: { a: { name: "Fix login and logout", terminal: "t1" } }, renames: [{ id: "a", name: "Fix login and logout" }] });
check("renamed by hand: stops following",
  tabNames(sp(tab("a", "Mine", true)), [pane("a", "t1", "Fix login")], { a: { name: "Fix login", terminal: "t1" } }), { owners: {}, renames: [] });
check("the same agent while it's there, not the first split",
  tabNames(sp(tab("a", "Second", true)), [pane("a", "t1", "First"), pane("a", "t2", "Second")], { a: { name: "Second", terminal: "t2" } }),
  { owners: { a: { name: "Second", terminal: "t2" } }, renames: [] });
check("agent gone: keeps its last name",
  tabNames(sp(tab("a", "Fix login", true)), [pane("a", "t1", "bash", shell, null)], { a: { name: "Fix login", terminal: "t1" } }),
  { owners: { a: { name: "Fix login", terminal: "t1" } }, renames: [] });
check("long titles are cut",
  tabNames(sp(tab("a", "1")), [pane("a", "t1", "x".repeat(60))], {}).renames[0].name.length, 48);
check("closed tabs are forgotten",
  tabNames(sp(), [], { gone: { name: "x", terminal: "t9" } }), { owners: {}, renames: [] });

console.log(bad ? `${bad} of ${count} failed` : `all ${count} passed`);
process.exit(bad ? 1 : 0);

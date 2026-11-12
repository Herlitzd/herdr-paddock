// Modified from Herdr 0.1.11's shipped "spaces" mod (Apache-2.0, github.com/herdrdev/herdr-app):
// spaces grouped by project (a folder on a machine, a git repo or not), as Orca does,
// with their agents under them. See projects.js and agents.js.
//
// From the shipped mod: worktrees found from git, spaces grouped by machine when
// more than one is known, and after a space's name the repo its first terminal is
// in now, only where unusual: branch, ahead/behind. Click to switch, right-click for
// Herdr's space menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, terminals, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, props, home, readTextFile } from "herdr";
import { agentRow, subRow, tree, byParent, hookSubs, joinSubs, sameApp } from "./agents.js";
import { groupRows, reposToAdd, projectList, addProject, urgent, fromSpaceFolders, placedOf, placeSpace, reorderProject, naturalProject, prunePlaced } from "./projects.js";
import { Overlay, STORE, store, openMenu, openAdd, newSpaceIn } from "./overlay.js";
import { PR_SCRIPT, NO_PR, summarize, gitRow } from "./prs.js"; // Local patch (PRs)

// A short stable id for an element from any string (a project's key).
const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261).toString(36);

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
// Local patch (repoint): a terminal inside the space's folder wins, so moving the space's folder
// and cd-ing a shell there moves it, though its agent can't leave the old folder.
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  const mine = ps.filter((p) => tabs.has(p.tab) && p.cwd);
  const f = (s.folder ?? "").replace(/\/+$/, "");
  return (f && mine.find((p) => p.cwd === f || p.cwd.startsWith(f + "/"))?.cwd) || mine[0]?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Local patch (vs main): the branch against the remote's default branch: commits ahead,
// behind or not, and lines changed since they split (uncommitted changes included).
const VS_MAIN = `
export GIT_OPTIONAL_LOCKS=0
b=
[ -n "$1" ] && git rev-parse -q --verify "origin/$1" >/dev/null && b=origin/$1
[ -n "$b" ] || b=$(git symbolic-ref -q --short refs/remotes/origin/HEAD) || b=
[ -n "$b" ] || for x in origin/main origin/master; do git rev-parse -q --verify "$x" >/dev/null && { b=$x; break; }; done
[ -n "$b" ] || exit 3
printf '%s\\n' "$b"
git rev-list --left-right --count "$b...HEAD" || exit 1
if [ -n "$2" ] && git cat-file -e "$2^{commit}" 2>/dev/null; then git rev-list --count "$2..HEAD"; else echo -; fi
git -c core.fsmonitor=false diff --shortstat "$(git merge-base "$b" HEAD)" --
`;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
// Local patch (color): draw the stored space colors (shared "space.colors": a name above or a #rrggbb).
const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
const spaceFill = (w) => {
  const c = (shared("space.colors") ?? {})[w.id];
  return !c ? null : c.startsWith("#") ? c.slice(0, 7) : MARK[c] ?? null;
};

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    // The same mod draws its popups (a project's menu, its dialogs): see overlay.js.
    if (props()?.role) { this.part = new Overlay(); this.part.init(cx); return; }
    // On first start (no projects kept yet): the folders of the space-folders mod, if it
    // was used here, become projects.
    if (!localStorage.getItem("imported") && !shared(STORE)) {
      localStorage.setItem("imported", "1");
      cx.spawn(async (cx) => {
        const text = await readTextFile(`${home()}/.config/herdr-space-folders.json`).catch(() => null);
        const found = text ? fromSpaceFolders(text, home()) : [];
        if (found.length) setShared(STORE, found.reduce((s, f) => addProject(s, null, f.root, { name: f.name }), store()));
        cx.notify();
      });
    }
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.closed = new Set(JSON.parse(localStorage.getItem("projects.folded") ?? "[]"));
    this.idleOpen = new Set(JSON.parse(localStorage.getItem("projects.idleOpen") ?? "[]")); // Local patch (idle)
    // A space's agents show under it unless folded here; when each last changed state.
    this.shut = new Set(JSON.parse(localStorage.getItem("agents.folded") ?? "[]"));
    // Spaces pinned to the top of their project (of the loose spaces, out of one).
    this.pins = new Set(JSON.parse(localStorage.getItem("pins") ?? "[]"));
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.byspace = {};
    this.repoOf = {}; // JSON [machine, project folder] -> { v: in a git repo (null: unknown), at, busy }
    this.repoAsk = new Set();
    // The agents' times, while any is shown.
    cx.timer.every(30000, (cx) => { if (Object.keys(this.byspace).length) cx.notify(); });
    this.projectOf = {}; // space index -> its project's id, or null
    this.naturalOf = {}; // space index -> the project its folder or repo puts it in
    this.overProject = null; // a project (or "out") a dragged space is over
    this.moving = null; // a project being dragged: { key, id, machine, n }
    this.overMove = null;
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    // Local patch (PRs): JSON [where(), branch] -> a PR summary, or null for none.
    try { this.prs = JSON.parse(localStorage.getItem("prs") ?? "{}"); } catch { this.prs = {}; }
    this.prAt = {};
    cx.timer.every(3000, (cx) => { this.checkPrs(cx); this.fetchMains(cx); });
  }

  // Local patch (PRs): each space on a branch asks gh for its PR; an open one (or none yet)
  // again every 2 minutes while the window is in front, a merged or closed one every 15.
  checkPrs(cx) {
    if (this.prBusy) return;
    const ps = panes(), due = [], keep = {};
    for (const w of spaces()) {
      const key = where(w, ps), g = this.git[key];
      if (!g?.branch || NO_PR.has(g.branch) || g.branch.startsWith("(")) continue;
      const k = JSON.stringify([key, g.branch]);
      keep[k] = true;
      const pr = this.prs[k], age = Date.now() - (this.prAt[k] ?? 0);
      const every = pr && pr.state !== "OPEN" ? 900000 : 120000;
      if (!(k in this.prAt) || (window().active && age > every)) due.push([k, key]);
    }
    if (!due.length) return;
    this.prBusy = true;
    cx.spawn(async (cx) => {
      for (const [k, key] of due) {
        const [on, cwd] = JSON.parse(key);
        this.prAt[k] = Date.now();
        const r = await exec("sh", ["-c", PR_SCRIPT], { cwd, on }).catch(() => null);
        if (r?.code === 0) {
          try {
            this.prs[k] = summarize(JSON.parse(r.stdout));
            // Local patch (vs main): a new base to compare with.
            const m = this.git[key]?.main;
            if (m && ((this.prs[k].base && m.base !== `origin/${this.prs[k].base}`) || m.head !== this.prs[k].oid)) this.refreshGit([key], cx);
          } catch {}
        }
        else if (r?.code === 3) this.prs[k] = null;
        cx.notify();
      }
      // Forget a PR only once its place is known to be on another branch, or gone.
      const places = new Set(spaces().map((w) => where(w, panes())));
      for (const k of Object.keys(this.prs)) {
        const [place, branch] = JSON.parse(k);
        if (!keep[k] && (!places.has(place) || (place in this.git && this.git[place]?.branch !== branch))) delete this.prs[k];
      }
      localStorage.setItem("prs", JSON.stringify(this.prs));
      this.prBusy = false;
    });
  }

  // Local patch (vs main): each repo fetches its default branch every 10 minutes while the
  // window is in front, so "behind" means behind GitHub; the repo watch then refreshes it.
  fetchMains(cx) {
    if (this.fetchBusy || !window().active) return;
    this.fetchAt ??= {};
    const seen = new Map();
    for (const [key, g] of Object.entries(this.git)) if (g?.main && !seen.has(g.repo)) seen.set(g.repo, [key, g.main.base]);
    const due = [...seen].filter(([repo]) => Date.now() - (this.fetchAt[repo] ?? 0) > 600000);
    if (!due.length) return;
    this.fetchBusy = true;
    cx.spawn(async (cx) => {
      for (const [repo, [key, base]] of due) {
        this.fetchAt[repo] = Date.now();
        const [on, cwd] = JSON.parse(key);
        const [remote] = base.split("/");
        await exec("sh", ["-c", 'export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes"; timeout 30 git remote set-head "$1" --auto >/dev/null 2>&1; timeout 120 git fetch --quiet "$1"', "sh", remote], { cwd, on }).catch(() => null);
        // Elsewhere than this computer nothing watches the repo: look again now.
        this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === repo), cx);
      }
      this.fetchBusy = false;
    });
  }

  prRows({ w, inset }, t) {
    if (this.shut.has(w.id)) return [];
    const key = where(w, this.ps ?? panes()), g = this.git[key];
    const pr = g?.branch ? this.prs?.[JSON.stringify([key, g.branch])] ?? null : null;
    // On the base branch itself (no main stats) and no PR: no row.
    // No PR and nothing to say (no commits, changes or "behind"): no row either.
    const m = g?.main;
    const busy = m && (m.ahead || m.add || m.del || m.behind || g.dirty);
    return pr || busy ? [gitRow(pr, g.main ?? null, g, w, t, { inset, onOpen: () => this.openPr(w, key, pr), onRefresh: (cx) => this.refreshPlace(key, cx) })] : [];
  }

  // Local patch (Redline): the PR in Redline's one-request view, in its own tab ("PR #n") in the
  // space (shown first). Clicking again goes back to that tab.
  openPr(w, key, pr) {
    const [on, cwd] = JSON.parse(key);
    const sp = spaces().find((s) => s.id === w.id);
    if (!sp) return;
    if (!sp.active) run("space.select", { id: sp.id });
    const name = `PR #${pr.number}`;
    const old = sp.tabs.find((x) => x.name === name && panes().some((p) => p.tab === x.id && p.mod === "redline"));
    if (old) return run("tab.select", { id: old.id });
    run("tab.new", { space: sp.id, name, mod: "redline",
      props: { pr: { cwd, on, number: pr.number, title: pr.title, head: pr.head, base: pr.base, url: pr.url, draft: pr.draft } } });
  }

  // Local patch (refresh): the git row's ↻: this place's git and PR again, now.
  refreshPlace(key, cx) {
    for (const k of Object.keys(this.prAt)) if (JSON.parse(k)[0] === key) delete this.prAt[k];
    this.refreshGit([key], cx);
    cx.timer.after(1500, (cx) => this.checkPrs(cx));
  }

  // Local patch (resume): after a reboot Herdr gives each terminal a plain shell again and never
  // reruns its program. A space with no agent left whose shell is in a folder Claude has
  // conversations for gets a "Resume Claude" row: `claude --continue` there, the folder's latest.
  resumable(w) {
    if ((this.byspace[w.id] ?? []).length) return null;
    const tabs = (w.tabs ?? []).map((x) => x.id), ps = this.ps ?? panes();
    for (const tab of tabs) for (const p of ps) {
      if (p.tab !== tab || !p.terminal || !p.program?.shell || !p.cwd) continue;
      if (this.convo?.[JSON.stringify([w.machine ?? null, p.cwd])]?.v) return p;
    }
    return null;
  }

  // Called from render (throttled): JSON [machine, folder] -> { v: has Claude conversations, at }.
  checkConvos(cx) {
    this.convo ??= {};
    if (this.convoBusy || Date.now() - (this.convoLook ?? 0) < 3000) return;
    this.convoLook = Date.now();
    const ps = panes(), due = new Set();
    for (const w of spaces()) {
      if ((this.byspace[w.id] ?? []).length) continue;
      const tabs = new Set((w.tabs ?? []).map((x) => x.id));
      for (const p of ps) {
        if (!tabs.has(p.tab) || !p.terminal || !p.program?.shell || !p.cwd) continue;
        const k = JSON.stringify([w.machine ?? null, p.cwd]);
        if (Date.now() - (this.convo[k]?.at ?? 0) > 300000) due.add(k);
      }
    }
    if (!due.size) return;
    this.convoBusy = true;
    cx.spawn(async (cx) => {
      for (const k of due) {
        const [on, cwd] = JSON.parse(k);
        // Only conversations from the claude CLI count: `--continue` skips SDK runs (Dispatch's intake).
        const r = await exec("sh", ["-c", 'grep -qsF \'"entrypoint":"cli"\' "$HOME/.claude/projects/$1"/*.jsonl', "sh", cwd.replace(/[^A-Za-z0-9]/g, "-")], { on }).catch(() => null);
        this.convo[k] = { v: r?.code === 0, at: Date.now() };
      }
      this.convoBusy = false;
      cx.notify();
    });
  }

  resumeRows({ w, inset }, t) {
    const p = this.resumable(w);
    if (!p) return [];
    const busy = this.resuming === p.terminal;
    return [h_flex().id(`space-resume-${w.id}`).h(24).flex_none().pl(inset ? 51 : 33).pr(8).gap(7).items_center().rounded(6)
      .text_size(12).text_color(t.muted).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
      .tooltip(`claude --continue in ${p.cwd}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (busy) return;
        this.resuming = p.terminal;
        cx.notify();
        if (!w.active) run("space.select", { id: w.id });
        run("pane.focus", { pane: p.pane });
        cx.spawn(async (cx) => {
          await hc(["send", p.terminal, "claude --continue"]).catch(() => null);
          cx.timer.after(4000, (cx) => { this.resuming = null; cx.notify(); });
        });
      })
      .child(svg("mods/paddock/icons/refresh.svg").size(12).flex_none())
      .child(div().min_w(0).flex_1().truncate().child(busy ? "Resuming…" : "Resume Claude"))];
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
    if (this.repoAsk.size) this.askRepos(cx);
  }

  // Projects' folders: in a git work tree or not ("true" from git). Each folder on
  // its own, so a slow machine doesn't hold up the rest.
  askRepos(cx) {
    const keys = [...this.repoAsk];
    this.repoAsk.clear();
    for (const key of keys) {
      const [on, root] = JSON.parse(key);
      cx.spawn(async (cx) => {
        const r = await exec("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { on }).catch(() => null);
        const was = this.repoOf[key]?.v ?? null;
        // Unreachable (a machine away): keep what it knew; asked again in a minute.
        this.repoOf[key] = { v: r ? r.code === 0 && r.stdout.trim() === "true" : was, at: Date.now(), failed: !r, busy: false };
        if (!r || this.repoOf[key].v !== was) cx.notify();
      });
    }
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      // Local patch (vs main)
      // Against the PR's base when it has one (a stacked PR's is another branch).
      const prBase = info.branch ? this.prs?.[JSON.stringify([key, info.branch])]?.base ?? "" : "";
      const prHead = info.branch ? this.prs?.[JSON.stringify([key, info.branch])]?.oid ?? "" : "";
      const vs = await exec("sh", ["-c", VS_MAIN, "sh", prBase, prHead], { cwd, on }).catch(() => null);
      // Uncommitted changes, untracked files included.
      info.dirty = r.stdout.split("\n").filter((l) => l && !l.startsWith("#")).length;
      if (vs?.code === 0) {
        const [b, counts = "", unpushed = "-", stat = ""] = vs.stdout.split("\n");
        const [behind, ahead] = counts.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
        if (info.branch !== b.replace(/^[^/]+\//, "")) info.main = {
          base: b, behind, ahead, unpushed: unpushed.trim() === "-" ? null : parseInt(unpushed, 10) || 0, head: prHead,
          add: parseInt(/(\d+) insertion/.exec(stat)?.[1] ?? "0", 10),
          del: parseInt(/(\d+) deletion/.exec(stat)?.[1] ?? "0", 10),
        };
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    return out;
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    // A space's row, then its agents' (as many elements as that takes).
    const draw = (r) => (collapsed ? [this.compact(r, t)] : [this.row(r, t), ...this.prRows(r, t), ...this.agentRows(r, t), ...this.resumeRows(r, t)]);
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : this.section(rows, draw, t, collapsed, null);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find(k => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.folded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(connected, el => el.child(div().id(`machine-project-${m ?? "local"}`).flex_none().px(3).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .tooltip("New project")
            .on_click((_e, cx) => { cx.stop_propagation(); openAdd(m); })
            .child(svg("mods/workspace-chrome/folder-plus.svg").size(12))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", m ? { machine: m } : {}); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", m ? { machine: m } : {}))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      const kept = projectList(store(), m).length > 0;
      return [head, ...(folded ? [] : mine.length || kept ? this.section(mine, draw, t, collapsed, m) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // One machine's rows: its projects (a header, then their spaces; empty ones too),
  // then the spaces in none; or as Herdr lists them. On the narrow rail, a project
  // is its tile. A repo a space opens in joins the machine's projects by itself.
  section(rows, draw, t, collapsed, machine) {
    const ps = panes();
    const placed = rows.map((r) => ({ ...r, place: place(r.w, ps) }));
    let s = store();
    // Written only when a repo was found, never on a plain render.
    const repos = reposToAdd(s, machine, placed);
    if (repos.length) {
      for (const f of repos) s = addProject(s, machine, f.root, { name: f.name, auto: true });
      setShared(STORE, s);
    }
    const list = projectList(s, machine);
    const { projects, loose } = groupRows(list, placed, placedOf(s, machine));
    for (const r of placed) this.naturalOf[r.i] = naturalProject(list, r)?.id ?? null;
    for (const p of projects) for (const r of p.rows) this.projectOf[r.i] = p.id;
    for (const r of loose) this.projectOf[r.i] = null;
    const inset = (r) => draw({ ...r, tree: null, inset: true });
    const pinned = (list) => [...list.filter((r) => this.pins.has(r.w.id)), ...list.filter((r) => !this.pins.has(r.w.id))];
    const head = (p, n) => {
      const key = `${machine ?? ""}:${p.id}`;
      return [this.projectHead({ ...p, machine, key, n }, t, collapsed), ...(this.closed.has(key) ? [] : pinned(p.rows).flatMap(collapsed ? draw : inset))];
    };
    // Local patch (idle): projects with no space open go in a folded group at the bottom.
    const numbered = projects.map((p, n) => [p, n]);
    const idle = numbered.filter(([p]) => !p.rows.length);
    const gkey = machine ?? "";
    const open = this.idleOpen.has(gkey);
    return [
      ...numbered.filter(([p]) => p.rows.length).flatMap(([p, n]) => head(p, n)),
      ...pinned(loose).flatMap((r) => draw({ ...r, tree: null, worktree: Boolean(r.g?.linked) })),
      ...(idle.length && !collapsed ? [this.idleHead(gkey, idle.length, open, t)] : []),
      ...(open && !collapsed ? idle.flatMap(([p, n]) => head(p, n)) : []),
    ];
  }

  idleHead(gkey, count, open, t) {
    return h_flex().id(`idle-projects-${hash(gkey)}`).h(26).flex_none().px(8).gap(7).items_center().rounded(7)
      .text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.muted))
      .on_click((_e, cx) => {
        open ? this.idleOpen.delete(gkey) : this.idleOpen.add(gkey);
        localStorage.setItem("projects.idleOpen", JSON.stringify([...this.idleOpen]));
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().flex_1().child("No spaces"))
      .child(div().flex_none().child(String(count)));
  }

  // A project's tile: its color with a white mark, or plain; a branch for a repo, a folder otherwise.
  // Whether a project's folder is in a git repo, asked of git there once per folder
  // (see checkNew); until it answers, a project found from a repo, or holding a
  // space in one, is taken for one.
  isRepo(p) {
    const key = JSON.stringify([p.machine ?? null, p.root]), k = this.repoOf[key];
    // Asked once, again after 10 minutes (a git init), or a minute after it couldn't be.
    const age = k ? Date.now() - k.at : Infinity;
    if (!k?.busy && (!k || age > (k.failed ? 60000 : 600000))) { this.repoOf[key] = { ...(k ?? { v: null, at: 0 }), busy: true }; this.repoAsk.add(key); }
    return this.repoOf[key].v ?? (p.auto || p.rows.some((r) => r.g));
  }

  projectTile(p, t) {
    const repo = this.isRepo(p);
    // Local patch (color): a project gets a steady color from its key.
    const fill = MARK[PALETTE[parseInt(hash(p.key), 36) % PALETTE.length]];
    return h_flex().size(18).flex_none().rounded(5).items_center().justify_center().bg(fill)
      .child(svg("mods/workspace-chrome/folder.svg").size(12).text_color("#ffffff")); // Local patch (icons): a folder for every project; the branch icon means a worktree
  }

  // A project's row, Orca's way round: chevron, tile, name, then what's inside when
  // folded (a spinner, or a dot when something needs you), + on hover, the count.
  // Click folds it, right-click for its menu, drag it to reorder, drop a space on it
  // to put the space in it. With no space open it's dim.
  projectHead(p, t, collapsed) {
    const id = hash(p.key), closed = this.closed.has(p.key), empty = p.rows.length === 0;
    const status = closed ? urgent(p.rows.map((r) => r.w.status)) : null;
    const tell = status === "blocked" || status === "done";
    const target = this.pressed !== null && this.overProject === p.key;
    const moving = this.moving, aimed = moving && moving.key !== p.key && this.overMove === p.key;
    const head = h_flex().relative().id(`project-${id}`).h(28).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().rounded(7)
      .text_color(t.foreground).cursor_pointer()
      .when(target, (el) => el.bg(t.selected).border_1().border_color(t.accent))
      .when(!target, (el) => el.hover((s) => s.bg(t.hover)))
      .when(Boolean(moving) && moving.key === p.key && this.overMove !== p.key, (el) => el.opacity(0.5))
      .when(Boolean(aimed), (el) => el.child(div().absolute().left(0).right(0).h(2).bg(t.accent)
        .when(moving.n < p.n, (line) => line.bottom(0)).when(moving.n > p.n, (line) => line.top(0))))
      .on_mouse_down("left", () => { this.moving = { key: p.key, id: p.id, machine: p.machine, n: p.n }; this.overMove = p.key; })
      .on_mouse_move((_e, cx) => {
        const space = this.pressed !== null ? spaces()[this.pressed] : null;
        const into = space && (space.machine ?? null) === (p.machine ?? null) ? p.key : null;
        if (this.pressed !== null && this.overProject !== into) { this.overProject = into; this.over = null; cx.notify(); }
        const over = this.moving && (this.moving.machine ?? null) === (p.machine ?? null) ? p.key : null;
        if (this.moving && this.overMove !== over) { this.overMove = over; cx.notify(); }
      })
      .on_mouse_up("left", (_e, cx) => {
        if (this.pressed !== null && this.overProject === p.key) this.place(this.pressed, p.id);
        else if (this.moving && this.moving.key !== p.key && this.overMove === p.key) setShared(STORE, reorderProject(store(), p.machine, this.moving.id, p.id));
        this.endDrag();
        cx.notify();
      })
      .on_click((_e, cx) => {
        closed ? this.closed.delete(p.key) : this.closed.add(p.key);
        localStorage.setItem("projects.folded", JSON.stringify([...this.closed]));
        cx.notify();
      })
      .on_hover((on, cx) => { this.hoveredProject = on ? p.key : this.hoveredProject === p.key ? null : this.hoveredProject; cx.notify(); })
      .on_mouse_down("right", () => openMenu(p.machine, p.id));
    if (collapsed) return head.justify_center().tooltip(p.name).child(this.projectTile(p, t));
    return head
      .child(svg(`mods/workspace-chrome/chevron-${closed ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(this.projectTile(p, t))
      .child(div().flex_1().min_w(0).truncate().font_medium().text_color(empty ? t.muted : t.foreground).child(p.name))
      .when(closed && status === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900)))
      .when(closed && tell, (el) => el.child(div().flex_none().text_color(tone(t, status)).child(glyph(status))))
      .when(this.hoveredProject === p.key, (el) => el.child(div().id(`project-add-${id}`).flex_none().px(4).rounded(4).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("New space here")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); newSpaceIn(p, p.machine); })
        .child("+")))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(p.rows.length)));
  }

  // A space dragged into a project (`id`), or out of its own (null).
  place(index, id) {
    const s = spaces()[index];
    if (!s) return;
    setShared(STORE, placeSpace(store(), s.machine ?? null, s.id, id, { natural: this.naturalOf[index] ?? null }));
  }

  endDrag() {
    this.pressed = null; this.over = null; this.overProject = null; this.moving = null; this.overMove = null;
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  // Local patch (no repo twice): inside a project (`inset`) the project row already names the repo.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    // Local patch (vs main): the numbers are on the space's git row (prs.js); here only
    // where it is, and no upstream arrows.
    if (g.main) return h_flex().flex_1().min_w(0).justify_end().items_center().text_size(11.5).text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)));
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree, inset, worktree }, t) {
    const on = w.active;
    const fill = spaceFill(w);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      // Local patch (color): the active space is tinted with its color and marked at the left.
      .when(on, (el) => el.bg(fill ? `${fill}2e` : t.selected))
      .when(on && Boolean(fill), (el) => el.child(div().absolute().left(0).top(7).bottom(7).w(3).rounded(2).bg(fill)))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === i && this.over !== i, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(this.pressed < i, line => line.bottom(0))
          .when(this.pressed > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.moving = null;
        this.overMove = null;
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces()[this.pressed];
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? i : null;
        if (this.pressed !== null && (this.over !== over || this.overProject !== null)) {
          this.over = over;
          this.overProject = null;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.endDrag();
        if (from !== null && over === i && from !== i) {
          // Dropped on a space in another project (or in none): it joins that one too.
          if ((this.projectOf[from] ?? null) !== (this.projectOf[i] ?? null)) this.place(from, this.projectOf[i] ?? null);
          run("space.move", { id: spaces()[from].id, index: i + 1 });
        } else if (from === i) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_hover((on, cx) => { this.hoveredSpace = on ? w.id : this.hoveredSpace === w.id ? null : this.hoveredSpace; cx.notify(); })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(inset), el => el.pl(18))
          .when(Boolean(tree), el => el.pl(22))
          .child(this.agentChevron(w, t))
          .when(Boolean(tree), el => el.child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(fill ?? t.dim)))
          // A space's tile, as a project's: a window split in panes (Lucide's panels-top-left),
          // or a branch for a worktree.
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill ?? t.raised).items_center().justify_center()
            .child(svg(worktree ? "mods/workspace-chrome/git-branch.svg" : "mods/paddock/icons/panels-top-left.svg").size(12).text_color(fill ? "#ffffff" : t.muted))))
          .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree || inset, w.name, t) : div().flex_1())
          .child(this.agentStatus(w, t))
          .child(this.pinButton(w, t)),
      );
  }

  // At a space row's right end: a pin, always when pinned, on hover otherwise.
  pinButton(w, t) {
    const on = this.pins.has(w.id);
    if (!on && this.hoveredSpace !== w.id) return div();
    return div().id(`space-pin-${w.id}`).flex_none().p(2).rounded(4).text_color(on ? t.muted : t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(on ? "Unpin" : "Pin to the top of its project")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        on ? this.pins.delete(w.id) : this.pins.add(w.id);
        localStorage.setItem("pins", JSON.stringify([...this.pins]));
        cx.notify();
      })
      .child(svg("mods/workspace-chrome/pin.svg").size(12));
  }

  // ---- agents under their space ----

  // Each space's agents, and when each last changed state (kept, as the Agents list does).
  readAgents() {
    const now = Date.now(), by = {}, list = agents();
    let dirty = false;
    // Live terminals by parent, for sub-agents.
    const terms = terminals();
    this.kids = byParent(terms);
    // Sub-agents an agent runs inside itself, from the labels its hooks put on its terminal.
    // One its hooks never saw end (the agent killed mid-run) stops showing after 12 hours;
    // the agent's next session start clears it.
    this.hooked = new Map(terms.map((k) => [k.address, hookSubs(k.labels, now)]).filter(([, h]) => h.length));
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    this.spaceOf = new Map(list.map((a) => [a.address, a.space])); // Local patch (own space)
    for (const a of list) {
      (by[a.space] ??= []).push(a);
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s !== s) { this.changed[a.address] = { s, at: now }; dirty = true; }
    }
    // As the Agents list does: forget agents gone for 30 days.
    for (const [k, c] of Object.entries(this.changed)) if (!this.listed.has(k) && now - c.at > 30 * 86400000) { delete this.changed[k]; dirty = true; }
    if (dirty) localStorage.setItem("changed", JSON.stringify(this.changed));
    this.byspace = by;
    this.prune();
  }

  // Pins, folds and drags of spaces that are gone, as the Agents list prunes its pins:
  // only for a machine some of whose spaces are listed (so not while one is loading or
  // away), so a space id never inherits another's.
  prune() {
    const sp = spaces(), ids = new Set(sp.map((s) => s.id));
    const heard = new Set(sp.map((s) => s.machine ?? null));
    const machineOf = (id) => (id.includes("/") ? id.split("/")[0] : null);
    const gone = (id) => heard.has(machineOf(id)) && !ids.has(id);
    for (const [set, name] of [[this.pins, "pins"], [this.shut, "agents.folded"]]) {
      const old = [...set].filter(gone);
      if (old.length) { old.forEach((id) => set.delete(id)); localStorage.setItem(name, JSON.stringify([...set])); }
    }
    // prunePlaced hands back the same store when nothing goes: written only on a change.
    const before = store();
    let s = before;
    for (const m of heard) s = prunePlaced(s, m, ids);
    if (s !== before) setShared(STORE, s);
  }

  // Local patch (own space): sub-agents started into a space of their own (hc run from an agent)
  // show there, as that space's agent, not again under the agent that started them.
  kidsHere(space) {
    const kids = this.kids ?? new Map(), at = this.spaceOf ?? new Map(), out = new Map();
    for (const [p, list] of kids) {
      const here = list.filter((k) => !at.has(k.address) || at.get(k.address) === space);
      if (here.length) out.set(p, here);
    }
    return out;
  }

  agentRows({ w, inset }, t) {
    const list = this.byspace[w.id] ?? [];
    if (!list.length || this.shut.has(w.id)) return [];
    const now = Date.now();
    // Each agent, then its sub-agents under it: those it started as terminals (hc run),
    // then those it runs inside itself (from its hooks).
    return list.flatMap((a) => [
      agentRow(a, t, { inset, since: this.changed[a.address]?.at ?? 0, now }),
      ...joinSubs(tree(this.kidsHere(w.id), a.address), (this.hooked?.get(a.address) ?? []).filter((h) => sameApp(a.app, h.app)))
        .map((s) => subRow(s, t, { inset, listed: this.listed, parent: a, now })),
    ]);
  }

  // Before a space's tile, as on a project's row: a chevron folding its agents (an
  // empty slot when it has none, so the rows line up).
  agentChevron(w, t) {
    const list = this.byspace[w.id] ?? [];
    if (!list.length) return div().w(11).flex_none();
    const shut = this.shut.has(w.id);
    return div().id(`space-agents-${w.id}`).flex_none().rounded(3).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(shut ? `Show its ${list.length > 1 ? `${list.length} agents` : "agent"}` : "Hide its agents")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        shut ? this.shut.delete(w.id) : this.shut.add(w.id);
        localStorage.setItem("agents.folded", JSON.stringify([...this.shut]));
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${shut ? "right" : "down"}.svg`).size(11).text_color(t.dim));
  }

  // At a space row's right end while its agents are folded, as a folded project
  // shows it: a spinner while one works, a dot when one needs you or is done.
  agentStatus(w, t) {
    const list = this.byspace[w.id] ?? [];
    if (!list.length || !this.shut.has(w.id)) return div();
    const status = urgent(list.map((a) => a.status));
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
    if (status === "blocked" || status === "done") return div().flex_none().text_color(tone(t, status)).child(glyph(status));
    return div();
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  render(cx) {
    if (this.part) return this.part.render(cx);
    this.readAgents();
    this.ps = panes(); // Local patch (PRs)
    this.checkConvos(cx); // Local patch (resume)
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(!collapsed, el => el.child("Spaces"))
        .child(h_flex().flex_none().items_center()
          .when(!collapsed, el => el.child(div().id("project-new").size(26).flex_none().flex().items_center().justify_center().rounded(6)
            .hover(s => s.bg(t.hover).text_color(t.foreground))
            .tooltip("New project: a folder on this computer")
            .on_click(() => openAdd(null))
            .child(svg("mods/workspace-chrome/folder-plus.svg").size(14))))
          .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14)))))
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        // Released on the drop zone: out of its project. Anywhere else: nothing.
        .on_mouse_up("left", (_e, cx) => {
          if (this.pressed !== null && this.overProject === "out") this.place(this.pressed, null);
          this.endDrag();
          cx.notify();
        })
        .children(this.grouped(t, collapsed))
        .when(!collapsed && this.pressed !== null && Boolean(this.projectOf[this.pressed]), (el) => el.child(
          div().id("project-out").mt(6).h(34).flex_none().flex().items_center().justify_center().rounded(8).border_1().border_dashed()
            .border_color(this.overProject === "out" ? t.accent : t.border).text_size(12).text_color(this.overProject === "out" ? t.foreground : t.dim)
            .on_mouse_move((_e, cx) => { if (this.overProject !== "out") { this.overProject = "out"; this.over = null; cx.notify(); } })
            .child("Drop here to take it out of its project"))));
  }
}

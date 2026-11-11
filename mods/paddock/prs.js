// Local patch (PRs): a space's pull request, as a row under the space.
// Asked of gh where the space is: its branch's upstream name, its own name, then a
// search by the commit it's on (an agent may push under another name).
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { light } from "./agents.js";

const FIELDS = "number,title,url,state,isDraft,reviewDecision,statusCheckRollup,headRefName,baseRefName,headRefOid";
// Exit 3: no PR. Any other failure (gh signed out, offline): keep what was shown.
export const PR_SCRIPT = `
b=$(git branch --show-current) || exit 1
[ -n "$b" ] || exit 3
# The default branch (and its usual names) is never a PR's head.
d=$(git symbolic-ref -q --short refs/remotes/origin/HEAD | sed 's#^origin/##')
mainish() { case "$1" in ""|main|master|develop|trunk|"$d") return 0 ;; esac; return 1; }
u=$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null | sed 's#^[^/]*/##')
for x in $u $b; do mainish "$x" && continue; out=$(gh pr view "$x" --json ${FIELDS} 2>/dev/null) && { printf '%s' "$out"; exit 0; }; done
# By commit only with commits of its own: a branch still at main's tip would find main's last PR.
base=origin/\${d:-main}
git rev-parse -q --verify "$base" >/dev/null || exit 3
git merge-base --is-ancestor HEAD "$base" && exit 3
n=$(gh pr list --state all --search "$(git rev-parse HEAD)" --json number --jq '.[0].number' 2>/dev/null) || exit 1
[ -n "$n" ] || exit 3
gh pr view "$n" --json ${FIELDS}
`;

// Branches a PR is never from.
export const NO_PR = new Set(["main", "master", "develop", "trunk"]);

// What's kept: a small summary of gh's answer.
export function summarize(j) {
  const runs = j.statusCheckRollup ?? [];
  const bad = ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"];
  let checks = runs.length ? "pass" : null, failed = 0, pending = 0;
  for (const c of runs) {
    const state = c.__typename === "StatusContext" ? c.state : c.status !== "COMPLETED" ? "PENDING" : c.conclusion;
    if (bad.includes(state)) failed++;
    else if (state === "PENDING" || state === "EXPECTED" || state === "QUEUED" || state === "IN_PROGRESS") pending++;
  }
  if (failed) checks = "fail"; else if (pending) checks = "pending";
  return { number: j.number, title: j.title, url: j.url, state: j.state, draft: j.isDraft, review: j.reviewDecision || null, checks, failed, pending, total: runs.length, head: j.headRefName, base: j.baseRefName, oid: j.headRefOid };
}

const GREEN = "#3fae6a", PURPLE = "#8b7cf6", RED = "#d9649a", ORANGE = "#e3814f", YELLOW = "#d4a72c", GREY = "#8b8f98";

// A space's git row: its PR (GitHub icon, number, checks light, state) or a branch icon
// without one, then the branch against its base: +added -deleted, commits ahead, "behind".
// The PR's title and the details are in the tooltip; a click opens the PR.
// A status word in a tinted box of its color.
const pill = (text, color) => div().flex_none().px(4).rounded(4).text_size(11).bg(`${color.slice(0, 7)}33`).text_color(color).child(text);

export function gitRow(pr, m, g, w, t, { inset = false, onOpen, onRefresh }) {
  const done = pr && (pr.state === "MERGED" || pr.state === "CLOSED");
  const color = !pr ? t.dim : pr.state === "MERGED" ? PURPLE : pr.state === "CLOSED" ? RED : pr.draft ? t.dim : GREEN;
  const lightOf = !pr || done ? null : pr.checks === "fail" ? "blocked" : pr.checks === "pending" ? "working" : pr.checks === "pass" ? "done" : "idle";
  const word = !pr ? null : pr.state === "MERGED" ? ["merged", PURPLE] : pr.state === "CLOSED" ? ["closed", RED]
    : pr.review === "APPROVED" ? ["approved", GREEN] : pr.review === "CHANGES_REQUESTED" ? ["changes", RED] : pr.draft ? ["draft", GREY] : null;
  const tip = [];
  if (pr) {
    const checks = pr.checks === "fail" ? `${pr.failed} of ${pr.total} checks failing` : pr.checks === "pending" ? `${pr.pending} of ${pr.total} checks running`
      : pr.checks === "pass" ? `${pr.total} checks passed` : "No checks";
    const review = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" }[pr.review] ?? "no review";
    tip.push(`#${pr.number} ${pr.title}`, `${pr.state.toLowerCase()}${pr.draft ? " (draft)" : ""} · ${checks} · ${review}`);
  } else tip.push("No pull request");
  if (m) tip.push(`${g.branch}: ${m.ahead} commit${m.ahead === 1 ? "" : "s"} ahead of ${m.base}${m.behind ? `, ${m.behind} behind` : ""}`, `+${m.add} \u2212${m.del} lines since it split off`);
  // Against the PR's branch on GitHub: everything there, or some of it still here.
  const open = pr && !done && m && m.unpushed !== null && m.head === pr.oid;
  const pushed = open && m.unpushed === 0 && !g.dirty;
  const local = open && !pushed ? [m.unpushed ? `${m.unpushed} unpushed` : "", g.dirty ? "uncommitted" : ""].filter(Boolean).join(" + ") : "";
  if (pushed) tip.push("Everything is pushed to the PR");
  if (local) tip.push(`Not in the PR yet: ${[m.unpushed ? `${m.unpushed} commit${m.unpushed === 1 ? "" : "s"}` : "", g.dirty ? `${g.dirty} uncommitted file${g.dirty === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")}`);
  const counts = Boolean(m) && !pushed;
  if (g.ahead || g.behind) tip.push(`Upstream: ${g.ahead} to push, ${g.behind} to pull`);
  if (pr) tip.push("Click to open on GitHub");
  return h_flex().id(`space-git-${w.id}`).h(24).flex_none().pl(inset ? 51 : 33).pr(8).gap(7).items_center().rounded(6)
    .text_size(12).tooltip(tip.join("\n"))
    .when(Boolean(pr), (el) => el.cursor_pointer().hover((st) => st.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onOpen(cx); }))
    .child(lightOf === "done" ? div().size(8).flex_none().rounded(4).bg(GREEN) : lightOf ? light(lightOf, t) : div().size(8).flex_none())
    .child(svg(pr ? "mods/paddock/icons/github.svg" : "mods/workspace-chrome/git-branch.svg").size(13).flex_none().text_color(color))
    .when(Boolean(pr), (el) => el.child(div().flex_none().text_color(color).child(`#${pr.number}`)))
    .when(pushed, (el) => el.child(pill("\u2713 all pushed", GREEN)))
    .when(Boolean(local), (el) => el.child(pill(local, YELLOW)))
    .when(Boolean(m) && m.behind > 0, (el) => el.child(pill("behind", ORANGE)))
    .when(counts && m.add > 0, (el) => el.child(div().flex_none().text_color(GREEN).child(`+${m.add}`)))
    .when(counts && m.del > 0, (el) => el.child(div().flex_none().text_color(RED).child(`\u2212${m.del}`)))
    .when(counts && m.ahead > 0, (el) => el.child(div().flex_none().text_color(t.muted).child(`\u2191${m.ahead}`)))
    .child(div().flex_1())
    .when(Boolean(word), (el) => el.child(pill(word[0], word[1])))
    .when(Boolean(onRefresh), (el) => el.child(div().id(`space-git-refresh-${w.id}`).flex_none().p(2).rounded(4).cursor_pointer()
      .text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("Check git and the PR again")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onRefresh(cx); })
      .child(svg("mods/paddock/icons/refresh.svg").size(11))));
}

// A space's agents, under it in the sidebar as Orca shows them: a traffic light
// (red: needs you, amber: working, green: done, a ring: idle), the program and the
// session it's on, and how long it has been in that state. A click goes to it.
// Folded, the space's row carries just the lights.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run } from "herdr";
import { session } from "./session.js";

// Most urgent first, as Herdr ranks them; then as Herdr lists them.
const RANK = { blocked: 0, done: 1, working: 2, idle: 3 };
export const ordered = (list) => [...list].sort((a, b) => (RANK[a.status] ?? 4) - (RANK[b.status] ?? 4));

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// What a row says: "Pi · Fix login redirect", or the program alone.
export function label(a) {
  const name = a.program?.name || a.app || "Agent", s = session(a);
  return s ? { name, session: s } : { name, session: "" };
}

// The light: a filled dot for needs-you and done, a pulsing one while working, a ring idle.
export function light(status, t, size = 8) {
  const dot = div().size(size).flex_none().rounded(size / 2);
  if (status === "blocked") return dot.bg(t.blocked);
  if (status === "done") return dot.bg(t.done);
  if (status === "working") return dot.bg(t.working).loop("opacity", { from: 0.35, to: 1, period: 1200 });
  return dot.border(1.5).border_color(t.idle ?? t.dim);
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// One agent's row; `inset` matches its space's row inside a project.
export function agentRow(a, t, { inset = false, since = 0, now = Date.now() } = {}) {
  const { name, session: s } = label(a);
  const pic = icon(a.program, 13, t.muted);
  return h_flex().id(`space-agent-${a.address}`).h(24).flex_none().pl(inset ? 54 : 36).pr(8).gap(7).items_center().rounded(6)
    .text_size(12).cursor_pointer()
    .when(a.focused, (el) => el.bg(t.selected))
    .when(!a.focused, (el) => el.hover((st) => st.bg(t.hover)))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); run("pane.focus", { pane: a.pane }); })
    .child(light(a.status, t))
    .when(Boolean(pic), (el) => el.child(pic))
    .child(div().flex_none().max_w(110).truncate().text_color(a.status === "idle" ? t.muted : t.foreground).child(name))
    .when(Boolean(s), (el) => el.child(div().flex_none().text_color(t.dim).child("·"))
      .child(div().min_w(0).flex_1().truncate().text_color(t.muted).child(s)))
    .when(!s, (el) => el.child(div().flex_1()))
    .when(since > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - since))));
}

// The lights alone, for a space whose agents are folded.
export const lights = (list, t) => h_flex().flex_none().gap(3).items_center().children(ordered(list).map((a) => light(a.status, t, 7)));

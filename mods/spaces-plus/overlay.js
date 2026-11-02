// The sidebar's own popups, opened as overlays of this mod (props.role):
//   "project-menu"  a project's right-click menu: New space here, Rename, Remove
//   "rename"        a project's name
//   "add"           a folder to add as a project on another machine (here,
//                   the system's folder picker does it)
// Styled like Herdr's menu and prompt.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, openOverlay, run, theme, shared, setShared, exec } from "herdr";
import { projectList, addProject, removeProject, renameProject } from "./projects.js";

export const STORE = "spaces-plus.projects";
export const store = () => shared(STORE) ?? {};
export const project = (machine, id) => projectList(store(), machine).find((p) => p.id === id);
export const newSpaceIn = (p, machine) => run("space.new", { folder: p.root, ...(machine ? { machine } : {}) });

export class Overlay {
  init(cx) {
    const p = props();
    this.at = 0;
    this.error = null;
    this.handle = cx.focus_handle();
    if (p.role === "project-menu") { this.handle.focus(); return; }
    const value = p.role === "rename" ? project(p.machine, p.id)?.name ?? "" : "";
    this.text = value;
    this.input = InputState.new({ value });
    if (value) this.input.set_selected_range({ start: 0, end: value.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
  }

  items() {
    const { machine, id } = props();
    return [
      { label: "New space here", icon: "plus", run: () => { const p = project(machine, id); if (p) newSpaceIn(p, machine); } },
      { label: "Rename\u2026", icon: "square-pen", run: () => openRename(machine, id) },
      { label: "Remove project", icon: "x", line: true, run: () => setShared(STORE, removeProject(store(), machine, id)) },
    ];
  }

  choose(i) {
    const it = this.items()[i];
    if (!it) return;
    closeOverlay(props().overlay);
    it.run();
  }

  submit(cx) {
    const p = props();
    const text = this.text.trim();
    if (p.role === "rename") {
      setShared(STORE, renameProject(store(), p.machine, p.id, text));
      closeOverlay(p.overlay);
      return;
    }
    // "add": a folder on that machine, checked there.
    if (!text) { this.error = "Type the folder's path."; cx.notify(); return; }
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", 'cd -- "$1" 2>/dev/null && pwd -P', "sh", text.replace(/^~(?=$|\/)/, "$HOME")], { on: p.machine }).catch((e) => ({ code: 1, stderr: String(e) }));
      this.busy = false;
      const root = r.code === 0 ? r.stdout.trim() : "";
      if (!root) { this.error = `No folder at ${text} on ${p.machine}.`; cx.notify(); return; }
      setShared(STORE, addProject(store(), p.machine, root));
      closeOverlay(p.overlay);
    });
  }

  render() {
    const t = theme(), p = props();
    if (p.role === "project-menu") {
      const list = this.items();
      return v_flex().id("project-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
        .on_key_down((e, cx) => {
          if (e.key === "down") this.at = (this.at + 1) % list.length;
          else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
          else if (e.key === "enter") this.choose(this.at);
          else if (e.key === "escape") closeOverlay(p.overlay);
          else return;
          cx.notify();
        })
        .children(list.map((it, i) => v_flex()
          .when(Boolean(it.line), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
          .child(h_flex().id(`pm-${i}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click(() => this.choose(i))
            .child(svg(`mods/workspace-chrome/${it.icon}.svg`).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it.label)))));
    }
    const rename = p.role === "rename";
    const label = (text) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("project-dialog").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(rename ? "Rename project" : `New project on ${p.machine}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label(rename ? "Name" : "Folder"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().pt(6).text_size(11.5).text_color(this.error ? t.blocked : t.dim)
        .child(this.error ?? (rename ? "Empty goes back to the folder's name." : "A path on that machine, such as ~/code/app.")))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("pd-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("pd-save", rename ? "Save" : this.busy ? "Checking\u2026" : "Add", true, (_e, cx) => this.submit(cx))));
  }
}

export const openMenu = (machine, id) => openOverlayFor({ role: "project-menu", machine, id }, { kind: "popup", width: 200, height: 112 });
export const openRename = (machine, id) => openOverlayFor({ role: "rename", machine, id }, { kind: "dialog", width: 420, height: 210 });
export const openAdd = (machine) => openOverlayFor({ role: "add", machine }, { kind: "dialog", width: 440, height: 210 });

function openOverlayFor(p, how) {
  openOverlay({ mod: "spaces-plus", ...how, props: p });
}

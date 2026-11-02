# Paddock

Herdr's Spaces sidebar, by project, with your agents in it. Spaces sit under the
project they work in, Orca-style: a git repository with its worktrees, or any
folder you add. Under each space are its agents, with a traffic light, the
session they're on and how long they've been in that state, and the sub-agents
they started.

![Paddock](preview.png)

A mod for the [Herdr](https://herdr.dev) desktop app. It replaces the shipped
`spaces` list; everything else in your window stays as it is.

## What it does

- **Projects.** A project is a folder on one machine. A git repository a space opens
  in becomes one by itself (its worktrees join it); **New project** (the folder-plus
  button by "Spaces" or by a machine) adds any folder, with a name. Projects stay
  when their spaces close, dimmed, so their **+** can open one again.
- **Which project a space is in:** its repository's, else the deepest project folder
  holding where it works now. Drag a space onto a project to put it there, or onto
  the dashed "Drop here to take it out of its project" zone to take it out.
- **A project's row:** fold it, drag it to reorder, **+** (on hover) for a new space
  in its folder, right-click for **New space here**, **Edit project…** (name and
  folder) and **Remove project** (the folder and its spaces stay). Folded, it shows
  a spinner when an agent inside works and a dot when one needs you or is done.
- **Agents under their space:** a light in the theme's status colors (needs you,
  done, working pulsing, a ring when idle), the program, its session (read from its
  terminal title as [herdr-session-titles](https://github.com/choam2426/herdr-session-titles)
  does: Pi, Claude Code and Codex tested; OpenCode from its source) and the time in
  that state. A click goes to the agent. Sub-agents (started with
  `hc run`) hang under their parent with tree lines; a click peeks at one. The
  chevron before a space folds its agents.
- **Pin** (the pin on a space's row, on hover) keeps a space at the top of its project.
- **One kind of tile** for every row: a project is a branch (a git repository) or a
  folder, a space a window in panes, a worktree a branch.
- **Moving from space-folders?** On first start, its folders become projects.

Machines stay apart, as in Herdr: each has its own section and its own projects.

## Install

Ask your Herdr agent: *"add the mod at github.com/choam2426/herdr-paddock"*. It reads
[RECIPE.md](RECIPE.md) and the files, copies the mod and points a copy of your layout
at it.

By hand:

1. Copy the mod (use `$HERDR_APP_HOME` instead of `~/.config/herdr-app` if you set
   it). If you already have a mod named `paddock`, give this one another folder name
   and change the name in two places too: `mod: "paddock"` in `overlay.js` (its menus
   and dialogs) and `mods/paddock/icons/` in `main.js` (the space icon).

   ```sh
   git clone https://github.com/choam2426/herdr-paddock
   cp -R herdr-paddock/mods/paddock ~/.config/herdr-app/mods/
   ```

2. Copy the layout you use (Herdr's own are read-only). For the default, `main`:

   ```sh
   herdr-app do layout.clone '{"name":"main","as":"main-paddock"}'
   ```

3. In `~/.config/herdr-app/layouts/main-paddock.json`, set the block whose
   `content.mod` is `spaces` to `paddock`.

4. Check: `herdr-app check ~/.config/herdr-app/mods/paddock`, then `herdr-app status`
   should show `"errors": []`.

To go back: `herdr-app do layout.switch '{"name":"main"}'`.

## What it runs, reads and keeps

- As Herdr's own sidebar does: `git` in your spaces' folders (branch, ahead/behind,
  which repository) and `hc machine ls` every 15 seconds.
- `git rev-parse` in each project's folder, once and again every 10 minutes, to tell
  a repository from a plain folder. For a project on another machine, there.
- Adding or editing a project checks the folder: here by starting `git` in it, on
  another machine with `sh` there (which also expands `~`).
- On first start only, it reads `~/.config/herdr-space-folders.json` (the
  space-folders mod's file) if it exists, to turn its folders into projects.
- No network. Projects are kept in Herdr's shared state (`paddock.projects`), per
  machine. Folds, pins and when each agent last changed state are kept in the mod's
  own storage; entries for spaces and agents that are gone are dropped.

## Limits

- It's a copy of Herdr 0.1.11's `spaces` mod, so later changes to Herdr's own sidebar
  don't reach it. [RECIPE.md](RECIPE.md) is written so an agent can rebuild it on
  your version.
- Run on Windows with Herdr 0.1.11, with Pi, Claude Code and Codex agents. macOS and
  Linux are untested; nothing in it is Windows-only (paths are compared the Windows
  way, ignoring case, only for drive-letter paths, so on macOS a folder typed in
  another case is another folder). On another machine, only the folder check was
  tried (on Linux).
- Projects live in this computer's Herdr, so another computer connected to the same
  machine has its own list.

## Development

```sh
npm test    # projects, belonging, drag in and out, reordering, the space-folders import
```

## License

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). Derived from Herdr's shipped
`spaces` mod; one icon from [Lucide](https://lucide.dev) (ISC).

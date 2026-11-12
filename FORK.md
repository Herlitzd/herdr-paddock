# This fork

Herlitzd/herdr-paddock is a personal fork of [choam2426/herdr-paddock](https://github.com/choam2426/herdr-paddock),
run in Herdr Desktop on Windows with herdr-core in WSL. Changes are marked in the code with
`// Local patch (<name>)` comments, so they can be found and carried across upstream merges.

## What it changes

| Patch | What |
|---|---|
| color | spaces are drawn in their stored colors; the active one is tinted and marked at the left |
| icons | GitHub and refresh icons in `icons/` |
| vs main / PRs (`prs.js`) | a git row under each space: its PR (number, checks light, merged/closed/approved/draft pill), all-pushed or unpushed, behind, +/- lines and commits ahead against the default branch. A merged PR shows only its pill. Base branches are fetched every 10 minutes while the window is in front |
| refresh | a refresh button on the git row: git and the PR checked again now |
| Redline | clicking the PR row opens the PR in a `PR #n` tab with the Redline mod's single-PR view (`props.pr`); clicking again goes back to that tab |
| repoint | a space's place is the terminal inside its folder, so moving a space's folder and cd-ing a shell there moves it |
| own space | a sub-agent started into a space of its own shows there, not again under the agent that started it |
| idle | projects with no spaces fold into a "No spaces" group at the bottom |
| no name | an agent row with an icon and a session title shows only the title |
| no repo twice | a space inside a project doesn't repeat the repo name, only its branch |
| resume | after a reboot Herdr gives terminals a plain shell; a space with no agent whose shell is in a folder with Claude CLI conversations gets a "Resume Claude" row (`claude --continue`) |

## Install (Windows + WSL)

The repo is cloned on the Windows side, and Herdr's `mods/paddock` is a junction to the repo's
`mods/paddock`, so the running mod is always the checkout:

```
cmd /c mklink /J %USERPROFILE%\.config\herdr-app\mods\paddock %USERPROFILE%\src\herdr-paddock\mods\paddock
```

The layout that shows it is `layouts/main-paddock.json`. The sub-agent hooks are wired into Claude Code's
settings through Herdr's path (`.../herdr-app/mods/paddock/hooks/subagents.sh`), see `README.md`.

**Hot reload doesn't see edits through the junction**, and `herdr-app status` shows no error: the old
code just keeps running. After an edit, from WSL:

```sh
cd /mnt/c/Users/$USER/.config/herdr-app/mods && mv paddock paddock-reload && sleep 2 && mv paddock-reload paddock
```

Check first with `herdr-app.exe check 'C:\Users\<you>\.config\herdr-app\mods\paddock'`. After a reload the
sidebar has no git data for a few seconds, so projects and git rows appear a moment later.

## Committing and pushing

Work straight on `main`; there is no PR flow for this fork. From WSL, with the GitHub CLI logged in:

```sh
cd /mnt/c/Users/$USER/src/herdr-paddock   # the Windows user, if it differs from WSL's
git -c user.name=Herlitzd -c user.email=2797382+Herlitzd@users.noreply.github.com commit -am "..."
git -c credential.helper='!gh auth git-credential' push origin main
```

The noreply email keeps a work address out of a public repo. The credential helper is needed because git
in WSL has none configured for this checkout.

Upstream changes: `git fetch upstream && git merge upstream/main`, then look for conflicts around the
`Local patch` comments.

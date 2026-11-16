// Local patch (tab names): a tab nobody named is named after its agent's session, the title
// the agent gives its terminal ("Fix login redirect"), and follows it as it changes.
// Ideas from kaishin/herdr-renamer-mod, on top of session.js's reading of titles:
// - A tab someone named (F2, tab.new {name}) is theirs: it's never touched, unless its name is
//   still the one given here. Renaming a tab by hand stops it following.
// - One agent per tab, kept while it's there: a split's other agent or focus doesn't swap names.
// - No title worth a name (none yet, "Claude Code", a folder, a state): the tab keeps its name.
// Pure, so tests run it; main.js sends the renames and keeps `owners` in shared(TAB_NAMES).
import { session } from "./session.js";

export const TAB_NAMES = "paddock.tabnames";
const MAX = 48;

const cap = (s) => {
  const chars = Array.from(s);
  return chars.length > MAX ? chars.slice(0, MAX - 1).join("").trimEnd() + "…" : s;
};

/**
 * @param spaces spaces() (each with tabs: { id, name, named })
 * @param panes panes() (tab, terminal, title, app, program)
 * @param saved the last owners: tab id -> { name, terminal }
 * @returns {{ owners: Record<string, {name: string, terminal: string}>, renames: {id: string, name: string}[] }}
 */
export function tabNames(spaces, panes, saved) {
  const owners = {}, renames = [];
  for (const s of spaces ?? []) for (const tab of s.tabs ?? []) {
    const own = saved?.[tab.id];
    if (tab.named && own?.name !== tab.name) continue;
    const named = (panes ?? []).filter((p) => p.tab === tab.id && p.terminal && !p.program?.shell)
      .map((p) => ({ terminal: p.terminal, name: session(p) })).filter((p) => p.name);
    const from = named.find((p) => p.terminal === own?.terminal) ?? named[0];
    if (!from) { if (own) owners[tab.id] = own; continue; }
    const name = cap(from.name);
    owners[tab.id] = { name, terminal: from.terminal };
    if (name !== tab.name) renames.push({ id: tab.id, name });
  }
  return { owners, renames };
}

---
name: setup-project-map
description: One-time setup for the build-compass plugin.
disable-model-invocation: true
---

# Set up build-compass

Run each step, then report what was done and what was skipped.

1. **Check the companions.** Look for the `grilling` skill (from mattpocock/skills) and the `html-plan` skill. Both are optional. Tell the user which are missing and what each adds: `grill-page` needs `grilling`; the map can be built from an `html-plan` plan. Give the install commands from the plugin's README. Do not install anything yourself.

2. **Save the map style.** Look for `style.md` in a folder under `~/.claude/agent-memory/` whose name contains `project-map`. If none exists, ask the user: dark or light, and one accent color. Dispatch the `project-map` agent with only this request: save the given theme and accent to its memory and report the path. Do not draw a map in this step.

3. **Offer the CLAUDE.md pointer.** The `mapping-progress` skill fires on its description, and a line in `CLAUDE.md` makes that reliable. Show the user the block in [claude-md-block.md](claude-md-block.md) and ask whether to add it to `~/.claude/CLAUDE.md` (every project) or the project's `CLAUDE.md` (this one only), or to skip it. Add it only on a yes, at the end of the file, and only if a `# Project map` section is not already there.

4. **Offer a first map.** If the current folder is a project with something in it, offer to draw the first map now.

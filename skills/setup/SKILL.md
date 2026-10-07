---
name: setup
description: One-time setup for the build-compass plugin. Checks for Node and the optional companion skills, saves your map style, offers the CLAUDE.md pointer that keeps the map current, and offers to draw a first map. Safe to run again to see or change these.
disable-model-invocation: true
---

# Set up build-compass

Run each step, then report what was done, what was already in place and what was skipped. Running setup again is safe: a step whose work is already done says so and offers a change where one makes sense.

1. **Check Node.** Run `node --version`. The map's scripts need it: they read git, the plan and the finished data, so that the agent copies facts instead of working them out. If Node is missing, tell the user the map still works, but the agent then reads git and plans by hand, which is slower and less reliable, and that `html-plan` needs Node to pack its plans. Do not install it yourself.

2. **Check the companions.** Look in the skills available in this session for `grilling` (from mattpocock/skills) and `html-plan`. Both are optional. Tell the user which are installed and which are missing, and what each missing one adds: `grill-page` needs `grilling`; the map can be built from an `html-plan` plan. For a missing one, give the install commands from the plugin's README. Do not install anything yourself.

3. **Save the map style.** Look for `style.md` in a folder under `~/.claude/agent-memory/` whose name contains `project-map`.
   - If it exists, show the saved theme and accent and ask whether to keep them. Change them only if the user asks.
   - If none exists, or the user wants a change, ask: dark or light, and one accent color. Dispatch the `project-map` agent with only this request: save the given theme and accent to its memory and report the path. Do not draw a map in this step.

4. **Offer the CLAUDE.md pointer.** The `mapping-progress` skill fires on its description, and a line in `CLAUDE.md` makes that reliable. Look for a `# Project map` section in both `~/.claude/CLAUDE.md` and the project's `CLAUDE.md`. If either has one, say where and skip this step. Otherwise show the user the block in [claude-md-block.md](claude-md-block.md) and ask whether to add it to `~/.claude/CLAUDE.md` (every project) or the project's `CLAUDE.md` (this one only), or to skip it. Add it only on a yes, at the end of the chosen file.

5. **Offer a first map.** Check that the current folder is a git repository (`git rev-parse --is-inside-work-tree`) with at least one commit or some source files. If it is not a git repository, say the map needs git history to judge progress, and skip this step. Otherwise offer to draw the first map. On a yes, dispatch the `project-map` agent in the background with the project root, tell the user the map will be at `.project-map/map.html` in about a minute, and carry on. When the agent reports, give the user the path and the suggested next step.

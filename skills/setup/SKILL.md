---
name: setup
description: Set up build-compass and check what works. Checks Node, git and the companion skills, finds a duplicate manual install, saves your map style, sets how often the map updates, and offers a first map. Safe to run again.
disable-model-invocation: true
---

# Set up build-compass

Run each step. Running setup again is safe: a step whose work is already done says so and offers a change where one makes sense.

End with a report of what works, one line per capability, each **ready** or **unavailable** with the exact fix:

- **Project map**: needs git. Node makes it faster and more reliable.
- **Note at session start when the map is out of date**: needs Node.
- **Grilling in a page**: needs the `grilling` skill.
- **Maps built from plans**: needs the `html-plan` skill.
- **Checks the map runs itself**: needs Node and a list of commands in `.project-map/checks.json`.
- **Rules on the map**: needs Node. Say whether they are on or off for this project, and whether a graphify graph is there to add callers.

Then list what setup changed, and what it skipped.

1. **Check Node and git.** Run `node --version` and `git --version`. The map needs git to judge progress. The map's scripts need Node: they read git, the plan and the finished data, so that the agent copies facts instead of working them out. If Node is missing, tell the user the map still works, but the agent then reads git and plans by hand, which is slower and less reliable, and that `html-plan` needs Node to pack its plans. Do not install Node yourself.

   Also look for a manual install beside the plugin: `~/.claude/agents/project-map.md` or `~/.claude/skills/mapping-progress/`. If either exists, say that the map's agent and skills are installed twice, which runs them twice, and that the README's manual install is for people without the plugin. Remove nothing yourself.

2. **Check the companions.** Look in the skills available in this session for `grilling` (from mattpocock/skills) and `html-plan`. Both are optional. Tell the user which are installed and which are missing, and what each missing one adds: `grill-page` needs `grilling`; the map can be built from an `html-plan` plan. For a missing one, give the install commands from the plugin's README. Do not install anything yourself.

3. **Save the map style.** Look for `style.md` in a folder under `~/.claude/agent-memory/` whose name contains `project-map`.
   - If it exists, show the saved theme and accent and ask whether to keep them. Change them only if the user asks.
   - If none exists, or the user wants a change, ask: dark or light, and one accent color. Dispatch the `project-map` agent with only this request: save the given theme and accent to its memory and report the path. Do not update the map in this step.

4. **Offer the CLAUDE.md pointer and how often to update.** The `mapping-progress` skill fires on its description, and a line in `CLAUDE.md` makes that reliable and sets how often the map is updated. Look for a `# Project map` section in both `~/.claude/CLAUDE.md` and the project's `CLAUDE.md`.
   - If one exists, say where and which frequency it sets, and offer to change the frequency.
   - Otherwise ask two things: how often, from the three blocks in [claude-md-block.md](claude-md-block.md), with what each costs; and where, `~/.claude/CLAUDE.md` (every project) or the project's `CLAUDE.md` (this one only). Add the chosen block only on a yes, at the end of the chosen file. Skipping is a valid answer.

5. **Offer the check commands.** With a list of commands in `.project-map/checks.json`, the map agent runs them on each update, when the code has changed since they last ran, and the map shows which tasks they cover. Without one, every task says no check is recorded until someone reports a check.
   - If the list exists, show it and offer to change it.
   - Otherwise look for how this project is tested: test scripts in `package.json`, a build file, a Makefile, in the root and one folder down. Propose a list, each with a `name`, the command as `run`, the folder as `in`, and `timeoutSeconds` if it needs more than 300. Leave out anything that reaches a real service, costs money or needs secrets this machine may not have, and say that you left it out.
   - Write the list only on a yes, after checking that `.project-map/` is in `.gitignore`: a list that git tracks is refused. This file and `settings.json` in step 6 are the only things in `.project-map/` that are yours and the user's to write. Skipping is a valid answer.

   ```json
   { "checks": [ { "name": "Server tests", "run": "npm test", "in": "server", "timeoutSeconds": 300 } ] }
   ```

6. **Offer the rules.** On each update the map lists the rules the new work added, changed or removed: what the code now decides for a user, in plain words, with the function and line that enforce each one. This adds a little reading to every update that has new work. Look for `.project-map/settings.json`.
   - If it holds `"rules": false`, say the rules are off for this project and offer to turn them on.
   - Otherwise say they are on and offer to turn them off for this project.
   - Write the file only when the user asks for a change, after checking that `.project-map/` is in `.gitignore`. Keep any other key the file holds. Rules already on the map stay in its data and the page hides them; the change shows at the next update of the map.

   ```json
   { "rules": false }
   ```

   Then look for `graphify-out/graph.json` in the project root. If it is there, say that each rule will also list the functions that call its code, read from that graph. If it is not, say that this needs a graph built with graphify, which is optional and which the plugin never builds or refreshes. Do not run graphify yourself.

7. **Offer a first map.** Check that the current folder is a git repository (`git rev-parse --is-inside-work-tree`) with at least one commit or some source files. If it is not a git repository, say the map needs git history to judge progress, and skip this step. Otherwise offer to draw the first map. On a yes, dispatch the `project-map` agent in the background with the project root, tell the user the map will be at `.project-map/map.html` in about a minute, and carry on. When the agent reports, give the user the path and the suggested next step.

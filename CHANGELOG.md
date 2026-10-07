# build-compass

## Unreleased

- **Renamed to build-compass.** The plugin and its repository were called `project-map`. The plugin holds more than the map, and a different `project-map` skill draws code dependency graphs. Install with `build-compass@a-pavithraa`; commands start with `/build-compass:`. The agent, the skills and the `.project-map/` folder keep their names.
- **Plan responses are kept.** When you paste your response to an html-plan plan, the agent saves it in `.project-map/plan-responses/` with a hash of the plan. Later updates still know the plan was answered. If the plan changes after the response, the map shows it as awaiting you again.
- **Stable plan ids.** `map/plan-extract.mjs` reads a plan, plain or packed, and gives each claim an id that survives rewording and renumbering, stored in `.project-map/plan-index.json`. The agent no longer reads the plan's HTML.
- **Git facts from a script.** `map/gather.mjs` collects HEAD, push state, commits with their files and line counts, and uncommitted work. The agent copies these values instead of working them out.
- **Setup is `/build-compass:setup`.** It was `setup-project-map`. It now checks for Node, reports which companion skills are installed, shows and can change a saved map style, checks both `CLAUDE.md` files before adding the pointer, and offers a first map only in a git repository. Safe to run again.
- **Copy all answers on the map.** Picks on the map's decisions collect in one block under the decision list, copied with one button and pasted once, in place of one line per decision. Unpicked decisions are listed with the default that stands. Picks are kept in the browser across the page's reloads and drop out once the map records the answer.
- **Plans link packed.** The map links to `plan.packed.html` when it exists, because an unpacked plan opens unstyled outside html-plan's folder.
- **Worktrees on the map.** `gather.mjs` reports the work in other git worktrees, and the agent shows it as in progress on its branch. `mapping-progress` runs one map update at a time.
- **`check.mjs` checks against git.** Every commit hash and file path on the map must exist in the repository or on disk. It also checks that read-only decisions say where they are answered and that `plan.approval` is valid, and notes when `history/` holds more than 20 files.

## 0.1.0

First release.

- **`project-map` agent.** Reads a project and writes `.project-map/map-data.js`, which a ready-made page draws: the parts and their status, the tasks by milestone, the open decisions and a suggested next step. Each finished or in-progress task shows what changed: a description, the commit state and the files touched. Builds the map from an html-plan plan when the project has one, and reads the decisions a grilling session confirmed.
- **The map page.** Ships with the plugin, so the agent draws nothing. Clickable throughout, dark or light, any accent color, and it reloads itself when the data changes.
- **`mapping-progress` skill.** Tells Claude when to draw and update the map, what to pass to the agent, and how to answer "where are we?" from it.
- **`grill-page` skill.** Runs a grilling interview through a page: click an answer for each question, copy one block back. The open tab loads each new round by itself. Confirmed decisions are written to `.grill/decisions.md` for the plan and the map to read.
- **`setup-project-map` skill.** One-time setup: checks the optional companions, saves the map style, offers the `CLAUDE.md` pointer.

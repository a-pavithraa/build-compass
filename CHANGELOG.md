# project-map

## 0.1.0

First release.

- **`project-map` agent.** Reads a project and writes `.project-map/map-data.js`, which a ready-made page draws: the parts and their status, the tasks by milestone, the open decisions and a suggested next step. Each finished or in-progress task shows what changed: a description, the commit state and the files touched. Builds the map from an html-plan plan when the project has one, and reads the decisions a grilling session confirmed.
- **The map page.** Ships with the plugin, so the agent draws nothing. Clickable throughout, dark or light, any accent color, and it reloads itself when the data changes.
- **`mapping-progress` skill.** Tells Claude when to draw and update the map, what to pass to the agent, and how to answer "where are we?" from it.
- **`grill-page` skill.** Runs a grilling interview through a page: click an answer for each question, copy one block back. The open tab loads each new round by itself. Confirmed decisions are written to `.grill/decisions.md` for the plan and the map to read.
- **`setup-project-map` skill.** One-time setup: checks the optional companions, saves the map style, offers the `CLAUDE.md` pointer.

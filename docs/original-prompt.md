# The prompt this agent was created from

The prompt below is from a post by [@Voxyz_ai](https://x.com/Voxyz_ai) on X: https://x.com/Voxyz_ai/status/2107455844992299272. Credit for the idea and the prompt goes to them.

The agent in `agents/project-map.md` was written by Claude Code from it. Paste it into Claude Code to build your own version, and change whatever you like first: the model, the style questions, the statuses, the rules.

```
Set up a subagent that only draws project maps:

1. Create project-map in ~/.claude/agents: model: opus, effort: medium, memory: user. Preload the design skills I have installed (for example impeccable). It needs to read the code, git history, and issues (if there are any). It only writes to a .project-map/ folder in the project, and adds that folder to .gitignore.
2. The first time, run it in the foreground so it can ask me what style I like: dark or light, and one accent color. It saves my answer to memory and follows it every time. If I already have dashboard-builder, reuse the style it saved and don't ask me again.
3. The map is one HTML file that opens with a double-click. It breaks the project into a few main parts and marks each one done, in progress, not started, or stuck. For stuck parts, say what they're waiting on. Milestones live in the map: if I can't name them, read the README and commit history and propose a first version for me to edit. At the top, show how many things are left before the next milestone and a suggested next step, and highlight the parts that changed since the last update. Pick the other panels for this project; don't use a template.
4. Add a rule to ~/.claude/CLAUDE.md: before you run on your own for a long stretch, have project-map draw a version in the background; update it after every milestone; when I ask "where are we?", answer from the map. Follow the map's suggested next step. Put anything that needs my call in the map, and if I don't answer, keep going with the default. Leave any existing dashboard rule as it is.
```

## What the prompt leaves out

The agent and rules in this repo have moved on from the prompt in six ways. If you build from the prompt, add what you need.

**A ready-made page.** Point 3 says to pick the panels per project and not to use a template. Built that way, the agent wrote a new page on every run, which cost 100,000 to 200,000 tokens and 7 to 15 minutes each time on Opus. Here the page ships with the plugin and the agent writes only the project's data, which made a map take about a minute. The price is that every project gets the same layout.

**Clicking.** The prompt never says the map should be interactive, and the first map drawn from it had nothing to click: every detail sat in hover tooltips. The page here is clickable throughout. If you build from the prompt, add a fifth point:

```
5. The map is clickable. Parts, tasks, milestone items and decisions open their detail on click. The same item is selected in every panel it appears in, and references between items are links. The status legend filters the page. For decisions, let me pick an option and show me the line to paste back to you, because a page opened from disk cannot save itself.
```

**What each task changed.** The agent here records, for every finished or in-progress task, a description, the commit state and the files touched. See "What each task changed" in `agents/project-map.md`.

**Rules in a skill.** Point 4 puts the rules in `CLAUDE.md`. Here they live in the `mapping-progress` skill, and `CLAUDE.md` holds a one-line pointer to it, so the rules update with the plugin.

**Plans and grilling.** The agent here builds the map from an html-plan plan when one exists, and reads the decisions a grilling session confirmed. See "Plans written with html-plan".

**Defaults.** Point 4 says to keep going with the default when you do not answer. That is right for decisions that come up while building, and wrong for a grilling session or a plan, both of which exist to get your answer before anything is built. The `mapping-progress` skill narrows the rule accordingly:

```
A decision that comes up while you are building goes in the map with a default. If I don't answer, keep going with the default. That does not cover grilling or plans: wait for my confirmation at the end of a grilling session, and for my response to a plan, before building anything they cover.
```

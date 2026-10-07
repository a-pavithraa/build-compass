---
name: mapping-progress
description: Keep a project map current and answer from it. Use before a long autonomous stretch of work, after a milestone or a finished task, when a plan or grilling session has just been answered, or when the user asks where the project stands.
---

# Mapping progress

The **map** is `.project-map/map.html`: one page showing the project's parts, their status, the milestones, the open decisions and a suggested next step. It draws itself from `.project-map/map-data.js` and reloads when that file changes, so the user can leave it open. The `project-map` agent draws it (`project-map:project-map` when installed as a plugin). You decide when it is drawn and what it is told. Only the agent writes inside `.project-map/`.

## When to update the map

Dispatch the agent in the background, then carry on with the work:

- **Before a long stretch on your own.** The user should be able to open the map while you work.
- **After every milestone.**
- **After an html-plan plan is written, and again when the user pastes their response to it.**
- **After a grilling session is confirmed.**

An update takes about a minute. A map is finished when the agent's report names the next milestone, the items left and a suggested next step. Read the report: it also lists what the agent could not verify.

## What to tell the agent

The agent starts with no memory of the session. Give it, each time:

- the project root;
- every task finished since the last map, with its commits or commit range, or the fact that it is uncommitted. This is what makes the per-task record of files and commit state exact instead of inferred;
- the path of any html-plan plan. Keep plans inside the project so the map can link to them;
- the user's pasted response to a plan, in full, so the map knows which decisions were answered and which claims were struck;
- anything the user said about milestones or priorities, and any answer they gave to a decision on the map.

## First map on a machine

The agent needs a theme and an accent color, asked once and saved to its memory. Before the first dispatch, look for a saved style: `style.md` in a folder under `~/.claude/agent-memory/` whose name contains `project-map`. If there is none, ask the user two questions (dark or light; one accent color) and pass the answers to the agent, which saves them. If the agent's report says the style question is still open, do the same and run it again.

## Answering "where are we?"

Answer from the map: the next milestone, how many items are left, what changed, what is stuck and on what, and the open decisions. If the map is missing, or older than the latest work, update it first and say that you did.

Follow the map's suggested next step unless the user has said otherwise.

## Decisions

Two kinds, handled differently:

- **A decision that comes up while building** goes in the map with a default. If the user does not answer, keep going on the default. Pick defaults that are cheap to undo.
- **A grilling session or a plan** waits for the user. Build nothing they cover until the user has confirmed the grilling decisions, or responded to the plan.

When a grilling session comes before a plan, write the plan from `.grill/decisions.md`: a settled decision goes in as a claim and is not asked again; an open question becomes one of the plan's decisions. Ask a settled decision again only if the design has changed what it means.

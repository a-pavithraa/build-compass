---
name: grill-page
description: Run a grilling interview through a clickable page. Each round opens in the browser with options to click, and the user pastes one block of answers back. Use when the user wants to be grilled "in a page" or "with clickable options", or finds typing answers to grilling questions tedious.
---

# Grilling through a page

This skill covers the first two steps of a longer sequence: **grill, confirm, plan, respond, build, map**. It ends by writing the confirmed decisions to a file that the plan and the project map read.

The interview itself is the `grilling` skill from mattpocock/skills. Load it with the Skill tool and follow it for everything about what to ask: the design tree, the frontier, one round per frontier, finding facts yourself, and when the session is done. If `grilling` is not installed, tell the user to install mattpocock/skills and stop.

This skill changes one thing: how a round reaches the user and how the answers come back. Instead of printing the round in chat, you put it on a page. The user clicks, presses **Copy answers**, and pastes once.

## Before the first round

If `.grill/decisions.md` exists and is about the same piece of work, read it. Its settled decisions carry forward: put them in `decided` and do not ask them again. Ask one again only when the design has changed what the question means, and say that in the question's `why`.

## Each round

1. **Work out the round** as `grilling` says. Turn every question into a choice: two to four options that are real alternatives, with your recommended answer as one of them. The page adds "Something else" and a note field to every question, so do not add those yourself. A question with no sensible options (a name, a number) gets no options; the user types into "Something else".

2. **Set up the folder on the first round.** Create `.grill/` at the project root, copy `grill.html` from this skill's folder into it, and write `.grill/.gitignore` containing `*` so nothing in it is committed. Copy the file with the shell; you do not need to read it. The page is already designed and themed: do not restyle it, and pass the user's theme and accent through `style`.

3. **Write `.grill/grill-data.js`** with this round's questions, replacing the previous round's file:

   ```js
   window.GRILL = {
     "topic": "Scheduling sent messages",
     "round": 2,
     "written": "2026-10-07T17:42:10",
     "style": { "theme": "dark", "accent": "#3B82F6" },
     "decided": [
       { "question": "Who can schedule a message?", "answer": "Any signed-in user" }
     ],
     "questions": [
       {
         "id": "Q4",
         "question": "A send fails at its scheduled time. Do we retry?",
         "body": "Optional longer text, shown under the question.",
         "why": "Decides whether the queue needs a retry count.",
         "options": [
           { "label": "Retry three times, then mark failed", "detail": "Optional one-line consequence." },
           { "label": "Mark failed at once" }
         ],
         "recommended": 0,
         "multi": false
       }
     ]
   };
   ```

   - `written`: the time you wrote this file, to the second. Set a new value every time you write the file, including when you correct a round you already sent. The page keeps half-finished answers in the browser and uses this value to throw away answers that belong to an earlier version of the round.
   - `id`: number questions across the whole session (Q1, Q2, ...), not per round, so answers stay unambiguous.
   - `decided`: every decision settled in earlier rounds, in the user's words where they chose "Something else".
   - `recommended`: index into `options`. The page tags that option as recommended and does not select it: the user clicks it to agree. Omit it only if you have no recommendation.
   - `multi`: true when more than one option can hold at once.
   - `style`: if a folder under `~/.claude/agent-memory/` whose name contains `project-map` holds a `style.md`, use its theme and accent. Otherwise omit `style` and the page follows the system theme.
   - The value must be valid JSON after `window.GRILL = `. Escape quotes and newlines inside strings.

4. **Show the round.** On the first round, open the page and say so in one line: `start "" .grill\grill.html` on Windows (from PowerShell, `Start-Process .grill\grill.html`), `open .grill/grill.html` on macOS, `xdg-open .grill/grill.html` on Linux. If opening fails, give the path. On later rounds do not open it again: the open tab checks `grill-data.js` every two seconds and loads the new round by itself, and if the user is in another tab its title changes to "Round N is ready" and its icon blinks. Tell the user the round is ready. Open the page again only if they say they closed the tab.

5. **Wait for the paste.** Do not ask the questions in chat as well.

## Reading the answers

The pasted block looks like this:

```
Grill answers: Scheduling sent messages (round 2)

Q4. A send fails at its scheduled time. Do we retry?
   -> Retry three times, then mark failed (recommended)
   note: but tell the user after the first failure

Q5. How long do we keep sent rows?
   -> Something else: 90 days, then archive

Q6. Can a scheduled message be edited?
   -> (no answer) [recommended was: Yes, until one minute before]
```

- `(recommended)` after an answer means the user clicked your recommendation. That is agreement.
- A note changes the answer. Read it as part of the decision, and if it opens a new branch, add that branch to the tree. A note on an unanswered question is still worth reading.
- `(no answer)` means the user did not pick anything. It is not agreement with the recommendation. If the decision is cheap to undo, carry on with the recommendation and say that you did. If it is not, ask it again in the next round and say why.
- `Something else: (left blank)` is also an open question. Ask it again.
- If the user answers in chat instead of pasting, take that as the answer.

Then recompute the frontier and write the next round.

## Finishing

When the frontier is empty, finish as `grilling` says: summarise the decisions in chat and get the user's confirmation. Do not build anything, and do not treat an unanswered question's recommendation as confirmed.

Once the user confirms, write `.grill/decisions.md`, replacing any earlier version:

```markdown
# Decisions: Scheduling sent messages

Confirmed by the owner on 2026-10-07.

## Settled

- **Q4. A send fails at its scheduled time. Do we retry?** Retry three times, then mark failed. Note: tell the user after the first failure.
- **Q5. How long do we keep sent rows?** 90 days, then archive.

## Open

- **Q9. Who pays for SMS sends?** The owner wants to ask finance first.
```

- **Settled** holds only what the user answered or explicitly confirmed, in their words where they typed their own answer. Keep the question ids.
- **Open** holds every question still unanswered, with why it is open. Leave the heading in place with "None." under it if there are none.

This file is the handoff. If the user wants a plan next and `html-plan` is installed, write the plan from it: a settled decision is an input, stated in the plan as a claim and not asked again; an open question becomes one of the plan's decisions. The project map reads the same file.

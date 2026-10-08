# build-compass

## 0.3.5

- **A run of checks shows its progress.** `run-checks.mjs` printed nothing until the last check had finished, so a few minutes of tests looked stuck. It now says when each check starts and ends, when a result is reused, and when a check is left for the next run. The lines go to stderr; the result on stdout is unchanged.
- **The digest lists the tasks with no call stack.** 0.3.4 told the agent to fill in up to five older tasks on each update, but nothing told it which tasks had none, and an update could fill in none. The digest now names them as `callsMissing`, most recently worked on first, and the agent is pointed at that list. A call stack is still not guaranteed: a first map has no digest, and a task whose code is in another checkout cannot have one.
- **The README opens with what the map is built from.** The page comes from the code and git history, each finished task shows what changed, which checks ran and whether it is committed, and an update takes about a minute.

## 0.3.4

- **Call stacks reach older tasks.** A map that already had finished tasks never got their call stacks: the agent wrote one only for a task that changed in that update. Each update now also fills in up to five older tasks that have none, most recent first, until none are left.
- **No empty space beside the right-hand column.** The commits and the tables below them now follow the parts directly; they used to wait until the decisions, checks and findings beside them had ended.
- **Reports use names.** The agent's report names a part, task, milestone or decision, and no longer gives an id such as `plan-c9` alone.

## 0.3.3

- **The map can run your checks.** List the commands that check a project in `.project-map/checks.json`, and the agent runs them on each update through `map/run-checks.mjs`: only those commands, with a time limit each, and not again while the code is unchanged. A check that passed is recorded on every task with a file under the folder it covers. One that failed is shown for the whole project and on no task, because a failing suite does not say which task broke. Setup offers to write the list. A list that git tracks is refused, so one cannot arrive with someone else's repository.
- **Check a task by hand, and record it.** A task with no recorded check shows the code it runs through, from where it starts, with file and line, and asks what you saw: it worked, or it did not. Your result joins the answers you already copy to Claude, and the next update records it. `check.mjs` refuses a call that is not at the line the map gives.
- **File lists are complete.** The agent listed some of a commit's files under a task and left out others, test files among them, so a task could say it had tests and show none. A work record now lists every file of the commit that belongs to the task.

## 0.3.2

- **Milestone headers no longer overlap.** A milestone with one or two tasks got a column too narrow for its name, tag and tally, so they ran into the next column. A header is now two rows, the name and then the tag and tally, and every column is wide enough for the second row. The page no longer scrolls sideways on a phone.
- **Done, not checked.** A done task with no recorded check says so on its tile and in its details, and the details flag the missing check instead of leaving it as body text. The agent may say a task has tests only when a test file is in its work record.
- **The details work from the keyboard.** Opening them moves focus into them, they are a dialog named by the item, and closing returns focus to what opened them. Task tiles show the focus ring, which a not-started or selected tile used to hide.
- **The details' status row lines up.** The part and milestone labels sit on the same line as their chips.
- **Updates default to milestones everywhere.** The descriptions of the skill and the agent said "after a milestone or a finished task", which could trigger an update after every task for someone who chose milestones only.

## 0.3.1

- **An update writes only what changed.** The agent used to read the whole previous data file and write the whole new one, and that file grows with every task. `map/digest.mjs` now prints a short digest of the previous data, the agent writes a patch, and `map/merge.mjs` applies it, runs the same checks as `check.mjs`, and replaces the data only when they pass. Parts of the data the update does not touch, your own edits included, are left as they were. `merge.mjs` also files the previous data under `history/` and keeps the newest twenty.
- **Your `CLAUDE.md` is not loaded into the map agent.** The agent sets `omitClaudeMd`, so a long `CLAUDE.md` no longer adds to the cost of every update. It reads the README, the docs and the plan as before.
- **`gather.mjs` knows where an update starts.** With no `--since`, it starts from the commit the map was last read at, so the agent copies the page, reads the digest and gathers the git facts in one command.
- **One item of the map, on request.** `digest.mjs --item <id>` prints one task, part, milestone or decision in full. Claude uses it in place of reading the data file.
- **Manual install copies every script.** The README's copy line had missed `fingerprint.mjs` since 0.2.2.

## 0.3.0

- **What a task changed for you.** A done or in-progress task can open with before, now and one way to try it, taken from the diff, the commit messages and the plan. The agent leaves out what it cannot ground there.
- **Checked is separate from committed.** Claude passes the checks it ran on each task to the agent, and the task shows them as passed or failed with the commit they ran on. A task with no check says so: its code exists, which does not show that it works. `check.mjs` refuses a done task with a failed check, and `status.mjs` reports failing checks and how many done tasks have none.
- **Since you last looked.** The map remembers in your browser what you last marked as seen, and lists every status that moved and every decision answered since, across however many updates happened in between. **Mark as seen** clears it.
- **How often the map updates is your choice.** Setup offers three: after milestones, after every finished task, or only when asked, with what each costs. `mapping-progress` skips an update that would change nothing and sends tasks that finish close together in one update.
- **`/build-compass:status`.** Prints where the project stands from the map, in a few lines, without running the agent.
- **Setup reports what works.** It ends with one line per capability, ready or unavailable with the fix. It checks for git as well as Node, and tells you when a manual install sits beside the plugin.
- **A slow git no longer reads as up to date.** The summary used to give git four seconds and treat a timeout as no difference. It now waits for git. The session-start hook keeps its limit and stays silent when it is hit.

## 0.2.2

- **The map knows when it is out of date.** 0.2.0 compared only how many commits HEAD was ahead of the map. Checking out an older commit read as up to date, uncommitted edits never counted, and uncommitted work the map had already recorded counted as new. `gather.mjs` now records a fingerprint of the uncommitted work, the agent stores it with the commit, and `status.mjs` and the session-start hook call the map out of date when the checkout is at any other commit or the fingerprint differs.

## 0.2.1

- **Installing the plugin installs nothing.** 0.2.0 listed Playwright as a dev dependency, and installing the plugin ran `npm install`, which added 19 MB of test tooling to every install. The page tests now get Playwright only where they run.

## 0.2.0

- **Renamed to build-compass.** The plugin and its repository were called `project-map`. The plugin holds more than the map, and a different `project-map` skill draws code dependency graphs. Install with `build-compass@a-pavithraa`; commands start with `/build-compass:`. The agent, the skills and the `.project-map/` folder keep their names.
- **Plan responses are kept.** When you paste your response to an html-plan plan, the agent saves it in `.project-map/plan-responses/` with a hash of the plan. Later updates still know the plan was answered. If the plan changes after the response, the map shows it as awaiting you again.
- **Stable plan ids.** `map/plan-extract.mjs` reads a plan, plain or packed, and gives each claim an id that survives rewording and renumbering, stored in `.project-map/plan-index.json`. The agent no longer reads the plan's HTML.
- **Git facts from a script.** `map/gather.mjs` collects HEAD, push state, commits with their files and line counts, and uncommitted work. The agent copies these values instead of working them out.
- **Setup is `/build-compass:setup`.** It was `setup-project-map`. It now checks for Node, reports which companion skills are installed, shows and can change a saved map style, checks both `CLAUDE.md` files before adding the pointer, and offers a first map only in a git repository. Safe to run again.
- **Copy all answers on the map.** Picks on the map's decisions collect in one block under the decision list, copied with one button and pasted once, in place of one line per decision. Unpicked decisions are listed with the default that stands. Picks are kept in the browser across the page's reloads and drop out once the map records the answer.
- **Plans link packed.** The map links to `plan.packed.html` when it exists, because an unpacked plan opens unstyled outside html-plan's folder.
- **Worktrees on the map.** `gather.mjs` reports the work in other git worktrees, and the agent shows it as in progress on its branch. `mapping-progress` runs one map update at a time.
- **Where are we, in a few lines.** `map/status.mjs` prints the next milestone, items left, next step, what changed, what is stuck and the open decisions, and how far the map is behind git. Claude answers "where are we?" from it instead of reading the whole data file.
- **A stale map is noticed.** A `SessionStart` hook tells Claude when the project's map is behind git, so it updates the map before relying on it. It is silent when the map is current or there is none.
- **Pushed means on any remote.** A commit counts as pushed when any remote has it, so a branch pushed with `git push <remote> local:main` and no upstream no longer shows as unpushed.
- **Steadier claim ids.** A lightly reworded claim keeps its id even when its parent claim was rewritten.
- **Tests, run on every push.** `npm test` covers the four map scripts against throwaway git repositories, the map page's answers in a headless browser, and the data example in the agent's prompt, which must pass `check.mjs`. GitHub Actions runs them on every push.
- **The prompt's data example holds together.** It named tasks it never defined and gave an unpushed commit a link; both are fixed, and a test keeps it that way.
- **`check.mjs` checks against git.** Every commit hash and file path on the map must exist in the repository or on disk. It also checks that read-only decisions say where they are answered and that `plan.approval` is valid, and notes when `history/` holds more than 20 files.

## 0.1.0

First release.

- **`project-map` agent.** Reads a project and writes `.project-map/map-data.js`, which a ready-made page draws: the parts and their status, the tasks by milestone, the open decisions and a suggested next step. Each finished or in-progress task shows what changed: a description, the commit state and the files touched. Builds the map from an html-plan plan when the project has one, and reads the decisions a grilling session confirmed.
- **The map page.** Ships with the plugin, so the agent draws nothing. Clickable throughout, dark or light, any accent color, and it reloads itself when the data changes.
- **`mapping-progress` skill.** Tells Claude when to draw and update the map, what to pass to the agent, and how to answer "where are we?" from it.
- **`grill-page` skill.** Runs a grilling interview through a page: click an answer for each question, copy one block back. The open tab loads each new round by itself. Confirmed decisions are written to `.grill/decisions.md` for the plan and the map to read.
- **`setup-project-map` skill.** One-time setup: checks the optional companions, saves the map style, offers the `CLAUDE.md` pointer.

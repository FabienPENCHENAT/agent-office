# Agent Office — technical documentation

> For installation and an overview, see the [README](../README.md).

Agent Office is a local VS Code extension that answers one question first: **which agent is working right now?** It also shows what Claude Code doesn't show on screen: who hands work to whom, and when each agent hands its work back.

Your AI agents appear as pixel-art characters (up to **ten**) in a virtual office:

- top row: the **product manager's office**, the **challenger's office** and the **UX/UI design office** (one agent each), then the **small meeting room**;
- bottom row: the **large meeting room** (facing the product manager's office), the **engineering open space** with seven desks (developers, tech lead, QA and other technical profiles), and the lounge;
- the **nature lounge**, airy and green: a small pond with water lilies and a log bench, a few fir trees with a hammock, some tall grass and wildflowers, and a little stone path.

Private offices face you: the chair is against the wall, opposite the door, and you see the back of the screen. The desktop hides the chair and the seated agent's legs. An **LED strip** lights up above the screen when the agent is working. In the open space, the agent has its back to you and its screen animates.

The scene contains no text. Each desk holds an item in its agent's color (mug, lamp, folder), which matches the legend below the scene. The scene spans the full width of the panel.

The VS Code status bar spells out “Active agent: …”, “N active agents: …”, “No active agents” or an unknown status. Inside the panel, this message is not displayed (the scene and the legend are enough), but it is still announced to screen readers.

The office shows the agents' **status** and their **delegations**, not their work. The extension never shows code, files, commands, logs, prompts or conversation content.

The visual idea is inspired by [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents). The code, the sprites (drawn in code) and the office layout are original.

## What you see

| Situation | Source | On screen |
|---|---|---|
| An agent is working | **Real**: `busy` session or running subagent | It goes to its desk and types. A “working” bubble (small computer) floats above its head as soon as it becomes active, including on its way to the desk. Animated screen (open space) or lit LED strip (private office), yellow row in the legend. |
| An agent delegates to **one** other | **Real**: a subagent is launched | The delegating agent (with a “meeting” bubble) visits the other at its desk; they exchange bubbles, then both go back to what they were doing. |
| An agent delegates to **several** at once | **Real**: subagents launched a few seconds apart | Meeting: **small room** for up to 4 participants, **large room** beyond that. Everyone walks there with a “meeting” bubble; the delegating agent chairs the meeting, then everyone goes off to work. |
| A subagent finishes | **Real**: subagent marked `finished` | It brings its work (“paper” bubble, from the moment it sets off) to the delegating agent's desk, who accepts it (“✓” bubble), then it goes back to its idle routine. |
| A subagent has **no character of its own** | **Real**: running subagent of a built-in type (Explore, general-purpose, Plan…, forks, workflow agents) or a second instance of an agent already at work | A **mini-bot** (a small tracked robot with a screen head on a neck and a box body in a color per subagent type, with the “work” bubble while it runs) rolls in from the **doormat** at the right-hand end of the corridor. It takes a free open-space desk, first one with no assigned agent, then one whose agent is idle, and its screen lights up. If that agent gets back to work, the mini-bot gives up the desk. With no free desk, it sits on the floor in the corridor, back to the wall, the light on its body blinking. When the subagent finishes, it leaves the same way. Up to **8** mini-bots; beyond that, a “+N” sign above the doormat counts the ones waiting outside. |
| An agent is idle | **Real** for the status; **decorative** for the activity | Free routine: hammock, bench by the pond, pond side, chat for two, stroll. |
| An agent **waits for you** | **Real**: session `waiting` (a permission or a question), or a subagent of that session silent for 30 s | It sits at its desk, in color, with an amber “raised hand” bubble. Its card says *“Waiting for your answer in Claude Code.”* The status bar reads *“Waiting for you: …”*, and the desktop app's icon shows its orange “!” bubble. A mini-bot does the same at its place. This state comes before working and unknown. |
| The status is unknown | Inconclusive signal or unavailable source | The character stops and turns grey, with a “?” bubble. |
| A stuck subagent is **dismissed** | **User action** on a grey subagent instance, not waiting for an answer (see below) | A “!” bubble, then it stands up, turns to face you, and a cardboard box pops up in its hands in a puff of dust, with a plant and a red mug sticking out. With a sweat drop, it hurries (and hops) to the doormat and out the door. A mini-bot is gone for good. An agent's character stays grey until it's outside, then walks back in empty-handed, in color, has a coffee and resumes its idle routine. |

Bubbles are always drawn on top of everything else. A character sitting on the side of a meeting table is drawn in front of the table.

Delegation scenes (visit, meeting, hand-in) are triggered **only** by an observed subagent launch or finish. Their duration and staging are illustrative. A scene only plays for a recent delegation (less than 90 seconds old): when the panel opens, old delegations are not replayed.

## Seasonal decorations

With `agentOffice.seasonalDecor` on (the default), the office follows the seasons. Winter is the only season so far: from December 1 to January 6 (local date). Off, the office is never decorated. The extension checks the date at every refresh, so the decorations appear and disappear on their own.

The former `agentOffice.christmasDecor` setting is deprecated: when `seasonalDecor` isn't set, `christmasDecor: "off"` still turns the decorations off (the desktop app rewrites it as `seasonalDecor: false` the next time it saves its settings file). Its old `on` value, which forced the decorations all year, is gone.

- **Outside**: snow falls behind the windows, which also get a holly wreath. The lounge is under snow: frozen pond, snow-capped fir trees and bushes, a snowman, falling snowflakes. The wildflowers are hidden.
- **Indoors**: string lights on the corridor-side walls (not on the façade of the top rooms), a decorated Christmas tree with presents in place of the open-space plant at the lounge side, a pile of presents along the right wall of the large meeting room, and a Santa hat on every character.

The presents and the snowman always occupy their tiles, decorated or not, so paths don't change with the season. In reduced-motion mode, the lights stay on and the snow stops falling.

## Editing an agent

Click a character: it stops and turns to face you, and a card shows its name with an **Edit agent file** link. The link opens the agent's definition (`.md`) in the editor; Claude Code only picks up the change in a new session. Clicking elsewhere or pressing `Escape` closes the card, and the character resumes what it was doing. Names in the list below the office open the file too (keyboard access). The **Claude** character has no file: its card only shows its name and model.

The file path stays in the extension: the view only sends back the agent's identifier, and only a file found during discovery can be opened.

## Dismissing a stuck subagent

A subagent that is interrupted (`Esc`, an error, a session that moves on) may never be marked `finished`. It then stays “working”, then “unknown” after `subagentSilenceMinutes` of silence, until it expires after 6 hours of silence. Subagents run inside their session's Claude Code process, so there is nothing to stop on their own: the office only offers to **hide** them. 

- **When**: as soon as an instance is grey (unknown, after `subagentSilenceMinutes` of silence) and not waiting for an answer, with no other condition. The card shows **Dismiss from office** on such a mini-bot, and **Dismiss stuck run** (or *Dismiss N stuck runs*) on a character that is grey only because of silent subagent instances (`AgentStatus.dismissableRuns`). A working instance, an instance or character **waiting for an answer**, and a main session (started with `--agent`, or the Claude character) never offer it.
- **How**: the view sends `{ type: 'dismiss', ids }` with the instance identifiers (`<sessionId>/<subagent file>`, also carried by each subagent signal as `runId`). `OfficeEngine.dismiss` only accepts identifiers that were grey at the last refresh, then refreshes at once. `state/dismiss.ts` removes those instances' signals and mini-bots from every following report, so the status bar, the legend and the office agree.
- **How long**: in memory, per engine (VS Code window or desktop window). A dismissed instance stays hidden only while it stays grey: it is forgotten once it leaves the report (finished or expired) or turns active or waiting again, and then it comes back to the office. It also reappears after a restart if it is still in the report. The view hides a dismissed mini-bot right away, but a report generated more than 3 s after the click that still lists it wins (the engine refused the dismissal, or the instance came back to life).
- Claude Code is never touched: no file is written, no process is signalled.

## Supported runtimes

| Runtime | Agent discovery | Active status and delegations |
|---|---|---|
| **Claude Code** (CLI and VS Code extension) | `~/.claude/agents/**.md` (user) and `<workspace>/.claude/agents/**.md` (project, which wins when names collide) | **Supported** |
| **GitHub Copilot** | `~/.copilot/agents/**.md` and `<workspace>/.github/agents/**.md` | **Not supported**: agents are shown as “unknown” |

Only the `name`, `color` and `description` fields of the frontmatter are read. Without `name`, the file name is used. The `description` is only used to guess an agent's room; it stays in the extension and is never sent to the view. Built-in agents (Explore, general-purpose…) and plugin agents don't get a desk: when they run as subagents, they appear as mini-bots (see above).

A **Claude** character is added for Claude Code sessions started without `--agent` (see below). It has no definition file, uses Claude's terracotta color, and can be hidden with `agentOffice.showDefaultClaude: false`. If you define an agent named `Claude` yourself, yours is used instead.

## Signal sources (Claude Code)

All of these are read-only, and the extension never starts a process.

1. **Session registry** `~/.claude/sessions/<pid>.json`, maintained by Claude Code: `pid`, `sessionId`, `cwd`, `status` (`busy` / `idle` / `waiting`, with a `waitingFor` detail).
   - A session is alive if its process still exists (`process.kill(pid, 0)`, which only checks that it exists).
   - A session whose process is gone is expired and ignored.
   - **Scope** (`agentOffice.sessionScope`, `project` by default): only the sessions whose `cwd` is one of the project folders or inside one are read. The project folders are the folders open in the VS Code window, or the desktop window's working folder plus `projectFolders`. Folder symlinks are resolved, and the comparison ignores case on macOS and Windows. A session without `cwd` is skipped. With no project folder, or with `all`, every session is read. Agent definitions are not affected: `~/.claude/agents` and the project's `.claude/agents` are always shown.
2. **Main agent** of a session (for example `claude --agent product-manager`): the `agent` field of the registry, otherwise the `{"type":"agent-setting","agentSetting":"<name>"}` entry in the first 64 KB of the transcript.
   - A session with neither is a conversation with Claude itself: it is attributed to the **Claude** character, and its model is the last `"model":"claude-…"` field in the final 64 KB of the transcript, shown as e.g. “Opus 5.5”. The transcript is only re-read when it changes.
   - Nothing else is read from the transcript.
   - `busy` → **working**; `idle` → **idle**; `waiting` → **waiting for you**; any other value → **unknown**.
3. **Subagents** `~/.claude/projects/<project>/<sessionId>/subagents/agent-*.meta.json` (`agentType`, `finished`, `spawnDepth`):
   - not finished → **working**;
   - silent for `agentOffice.subagentSilenceMinutes` (20 min by default) → **unknown**;
   - silent for more than 6 hours → expired.
   - Each running instance is also reported on its own. The first instance of an agent shown in the office is its character; every other instance becomes a mini-bot, oldest first. Only the subagent type is sent to the view, never its prompt.
4. **Delegations**: a depth-1 subagent was launched by the main agent of its session.
   - Launch: creation date of the subagent's transcript.
   - Finish: date `finished: true` was written.
   - Finished delegations stay reported for 10 minutes.
   - Only names and timestamps are passed to the view, never the prompt.

An agent is **working** if at least one of its instances is active. Otherwise it is **unknown** if a signal is inconclusive or the source can't be read. Otherwise it is **idle**. “No active agents” is only shown when every agent on display is confirmed idle.

Signals are read every `agentOffice.pollIntervalSeconds` seconds (2 by default).

## Settings panel (⚙)

The panel opens in the top-right corner of the scene; nothing is drawn on the scene itself. The host toggles it by posting `{ type: 'toggleSettings' }`: in VS Code, the `agentOffice.settings` command (⚙ in the view's title bar, `view/title` menu); in the desktop app, the ⚙ button of the folder bar (`media/standalone.js`). Escape or a click elsewhere closes it. It holds four settings: **Sessions shown** (`sessionScope`), **Show Claude** (`showDefaultClaude`), **Grey after** (`subagentSilenceMinutes`: 5, 10, 20 or 60; a different value set elsewhere is kept and shown) and **Seasonal decor** (`seasonalDecor`). The other settings are only in Settings or the settings file.

- Each snapshot carries the current values (`settings`) and the folders the sessions are filtered on (`scope`), so the panel and the footer line “Showing Claude Code sessions from … only” stay in sync with changes made elsewhere.
- A change sends `{ type: 'setSetting', key, value }`. The host validates it with `panelSetting()` (`core/settings.ts`): only these four keys and their listed values are accepted.
- VS Code writes it with `WorkspaceConfiguration.update`, to the workspace folder or workspace settings if the value is already defined there, otherwise to the user settings. The desktop app writes it to its `settings.json`, keeping the other keys; the file watcher then refreshes every window.
- For 3 seconds after a change, a snapshot doesn't overwrite that control, so a refresh already in progress doesn't flip it back.

## Ten desks, rooms and colors

**Which agents are shown** (stable rule):
1. first the **Claude** character, so it is always on display;
2. then those listed in `agentOffice.pinnedAgents`, in that order;
3. then all the others in alphabetical order of their name (case-insensitive).

The first ten are shown. Beyond that, agents are listed below the office with their status, and still counted in the status bar. With fewer than ten agents, the remaining desks are “free”.

**Which room for each agent**, in this order:
1. the `agentOffice.agentRooms` setting, if it names the agent;
2. the agent's **name**:

   | Role | Name containing… | Room |
   |---|---|---|
   | `pm` | `product-manager`, `product-owner`, `pm` | Product manager's office |
   | `challenger` | `challenger` | Challenger's office |
   | `design` | `ux`, `ui`, `design` | UX/UI design office |
   | `engineering` | a technical word: `dev`, `engineer`, `qa`, `test`, `tech`, `lead`, `architect`, `backend`, `frontend`, `ops`, `admin`, `doc`, `security`, `data`, `code`, `review`… | Engineering open space |

3. if the name says nothing about the role, the agent's **description** (English or French keywords): *product manager / owner*, *project manager*, *orchestrates*, *coordinates* → `pm`; *challenge*, *devil's advocate*, *brainstorm* → `challenger`; *UX*, *UI*, *user experience*, *designer*, *wireframe*, *mockup*, *Figma* → `design`. When several match, the keyword that appears first wins;
4. otherwise, `engineering`.

If two agents claim the same private office, the first in order gets it and the next one joins the open space. The **Claude** character takes the product manager's office only if no agent claims it, otherwise it joins the open space (`agentOffice.agentRooms` can still force its room). If the open space is full, free private offices are used as overflow. Each agent always keeps the same desk.

Example setting:

```json
"agentOffice.agentRooms": { "administrator": "engineering", "ux-ui-designer": "design" }
```

**Colors**: an agent's color is its frontmatter `color:` (a named color — `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`, `gray`, `white` — or a `#rrggbb` value). Agents without a color get the first color from a fallback palette of ten that no other agent on display is using, so two agents never share a color unless there are more than ten.

## Accessibility

- `workbench.reduceMotion` is respected: `on`, `off`, or `auto` (which follows `prefers-reduced-motion`).
- In reduced mode, the scene becomes **static**:
  - working agents are at their desk, the others at a fixed spot in the lounge;
  - there's no walking, no idle routine and no delegation scene; a dismissed instance simply disappears;
  - the scene is redrawn once per second.
- A text list of the ten desks and a `role="status"` / `aria-live` banner carry the information for screen readers. The canvas is decorative (`aria-hidden`).
- The legend pairs each name with the color of its character and desk item.

## Security and privacy

- Data stays **100% local**: no network request, neither in the extension nor in the Webview.
- The Webview uses a strict CSP: `default-src 'none'`, a single local script with a nonce, local styles and images only.
- The Webview only receives names, statuses, desks, colors and timestamps.
- The extension never writes to any Claude Code configuration, session or agent file (it can open an agent's file in the editor; you make the edits). It only writes its own settings (`agentOffice.*`, or the desktop app's `settings.json`) when you change them in the ⚙ panel, and only the four keys and values the panel offers. It doesn't start, stop or control any agent, and can't create one. Dismissing a stuck subagent only filters it out of the office's own display.

## Limits

- **Copilot**: there is no documented local interface exposing the activity or delegations of a Copilot agent.
- **Claude Code**: the `~/.claude/sessions` registry and the `subagents/*.meta.json` files are internal details, not publicly documented. They were observed with Claude Code 2.1.3xx and may change. If the registry disappears, the extension shows “Unknown status”.
- **Delegations at depth 2 or more** (a subagent launching another): their exact delegating agent can't be identified. These agents show as working, but without a visit or meeting scene.
- **Main session without `--agent`**: shown as the **Claude** character. Several such sessions share that one character: it works as long as any of them is busy, and shows the model of the most recent one.
- Grouping into a meeting assumes the subagents are launched less than 4 seconds apart. Beyond that, each one gets a visit.
- “Waiting for you” relies on the `waiting` session status, observed in Claude Code 2.1.3xx. Within a waiting session, the office can't tell which subagent asked: every subagent silent for 30 s shows as waiting.
- Guessing a room from the description is a heuristic. When it gets it wrong, set `agentOffice.agentRooms`.

## Running the extension

Requirements: Node.js 18 or later, and VS Code 1.90 or later.

```bash
npm install
npm run compile
```

- **In development**: open the folder in VS Code, then press `F5` (“Run Extension”).
- **As a VSIX**:
  ```bash
  npm run package          # builds agent-office-1.2.0.vsix
  code --install-extension agent-office-1.2.0.vsix
  ```
  You can also use the Command Palette: *Extensions: Install from VSIX…*

Then open the **Agent Office** panel (at the bottom, next to the Terminal). You can also run *Agent Office: Show the agent office*, or click the status bar item.

## Running the desktop app

```bash
npm run app        # compile, then start Electron on out/standalone/main.js
npm run app:dist   # electron-builder: dmg + zip (macOS), nsis + portable (Windows) in dist/
```

The package `main` stays the VS Code extension; electron-builder overrides it with `out/standalone/main.js` (`build.extraMetadata`). The window loads `agent-office://app/` — a custom protocol serving the page and `media/` only — with a CSP that allows no network and no inline script. The renderer is the unchanged `media/office.js`: `media/standalone.js` provides `acquireVsCodeApi` on top of a `contextBridge` preload, and `media/standalone.css` supplies the `--vscode-*` theme variables (dark/light follow the system). Settings are read from `<userData>/settings.json` at startup and again whenever the file changes, so edits are picked up live. The app icon follows the agents (`media/dock/`: `working`, `waiting` first, otherwise `idle`): on macOS the Dock icon sums up every open window, on Windows each window's taskbar icon follows its own folder. On macOS the app keeps running when its last window closes, like other Mac apps; clicking the Dock icon reopens the last folder. Each window owns one working folder and its own `OfficeEngine` (`projectDirs` = that folder + `projectFolders` from the settings); the recent folders live in `<userData>/state.json`. The ⚙ panel's `setSetting` messages are written to that `settings.json` after validation. The page asks for folder changes over IPC (`chooseFolder`, `switchFolder`, `newWindow`, `removeRecent`), and the main process only accepts paths that are in the recent list or come from its own folder dialog.

## Checks

```bash
npm run lint   # TypeScript types for the extension + JS check of the Webview
npm test       # discovery, Claude Code adapter, delegations, rooms, ten desks, banner
```

## Architecture

```
src/
  discovery/agentDefinitions.ts  read-only agent definitions (name, color, description)
  runtime/claudeCode.ts          Claude Code adapter → status signals + delegations
  runtime/copilot.ts             Copilot adapter: “not supported”
  state/normalize.ts             definitions + signals → working / waiting / idle / unknown (+ dismissable instances)
  state/dismiss.ts               hides the subagent instances dismissed from the office
  state/slots.ts                 stable rule for the ten desks
  state/placement.ts             role (setting, name, description) → room and desk
  state/summary.ts               answer to “which agent is working?”
  state/snapshot.ts              minimal snapshot sent to the view
  state/season.ts                seasonal decorations by date
  core/settings.ts               defaults and bounds for the settings, ⚙ panel keys and validation (VS Code and desktop app)
  core/engine.ts                 polling loop → snapshot, independent of VS Code
  view/officePage.ts             page markup shared by the Webview and the desktop window
  view/officeHtml.ts             Webview page + CSP
  extension.ts                   VS Code: activation, status bar, view (uses core/engine)
  standalone/main.ts             Electron main process: window, menu, protocol, settings watch
  standalone/preload.ts          contextBridge between the page and the main process
  standalone/store.ts            settings.json and recent folders (state.json) of the desktop app
media/office.js                  office layout, pathfinding, idle routine, delegation and dismissal scenes, colors, rendering
media/office.css                 banner, accessible legend
```

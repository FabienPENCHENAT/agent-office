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
| An agent is idle | **Real** for the status; **decorative** for the activity | Free routine: hammock, bench by the pond, pond side, chat for two, stroll. |
| The status is unknown | Inconclusive signal or unavailable source | The character stops and turns grey, with a “?” bubble. |

Bubbles are always drawn on top of everything else. A character sitting on the side of a meeting table is drawn in front of the table.

Delegation scenes (visit, meeting, hand-in) are triggered **only** by an observed subagent launch or finish. Their duration and staging are illustrative. A scene only plays for a recent delegation (less than 90 seconds old): when the panel opens, old delegations are not replayed.

## Supported runtimes

| Runtime | Agent discovery | Active status and delegations |
|---|---|---|
| **Claude Code** (CLI and VS Code extension) | `~/.claude/agents/**.md` (user) and `<workspace>/.claude/agents/**.md` (project, which wins when names collide) | **Supported** |
| **GitHub Copilot** | `~/.copilot/agents/**.md` and `<workspace>/.github/agents/**.md` | **Not supported**: agents are shown as “unknown” |

Only the `name`, `color` and `description` fields of the frontmatter are read. Without `name`, the file name is used. The `description` is only used to guess an agent's room; it stays in the extension and is never sent to the view. Built-in agents (Explore, general-purpose…) and plugin agents are not shown.

## Signal sources (Claude Code)

All of these are read-only, and the extension never starts a process.

1. **Session registry** `~/.claude/sessions/<pid>.json`, maintained by Claude Code: `pid`, `sessionId`, `cwd`, `status` (`busy` / `idle`).
   - A session is alive if its process still exists (`process.kill(pid, 0)`, which only checks that it exists).
   - A session whose process is gone is expired and ignored.
2. **Main agent** of a session (for example `claude --agent product-manager`): the `agent` field of the registry, otherwise the `{"type":"agent-setting","agentSetting":"<name>"}` entry in the first 64 KB of the transcript. Nothing else is read from the transcript.
   - `busy` → **working**; `idle` → **idle**; any other value → **unknown**.
3. **Subagents** `~/.claude/projects/<project>/<sessionId>/subagents/agent-*.meta.json` (`agentType`, `finished`, `spawnDepth`):
   - not finished → **working**;
   - silent for `agentOffice.subagentSilenceMinutes` (20 min by default) → **unknown**;
   - silent for more than 6 hours → expired.
4. **Delegations**: a depth-1 subagent was launched by the main agent of its session.
   - Launch: creation date of the subagent's transcript.
   - Finish: date `finished: true` was written.
   - Finished delegations stay reported for 10 minutes.
   - Only names and timestamps are passed to the view, never the prompt.

An agent is **working** if at least one of its instances is active. Otherwise it is **unknown** if a signal is inconclusive or the source can't be read. Otherwise it is **idle**. “No active agents” is only shown when every agent on display is confirmed idle.

Signals are read every `agentOffice.pollIntervalSeconds` seconds (2 by default).

## Ten desks, rooms and colors

**Which agents are shown** (stable rule):
1. first those listed in `agentOffice.pinnedAgents`, in that order;
2. then all the others in alphabetical order of their name (case-insensitive).

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

If two agents claim the same private office, the first in order gets it and the next one joins the open space. If the open space is full, free private offices are used as overflow. Each agent always keeps the same desk.

Example setting:

```json
"agentOffice.agentRooms": { "administrator": "engineering", "ux-ui-designer": "design" }
```

**Colors**: an agent's color is its frontmatter `color:` (a named color — `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`, `gray`, `white` — or a `#rrggbb` value). Agents without a color get the first color from a fallback palette of ten that no other agent on display is using, so two agents never share a color unless there are more than ten.

## Accessibility

- `workbench.reduceMotion` is respected: `on`, `off`, or `auto` (which follows `prefers-reduced-motion`).
- In reduced mode, the scene becomes **static**:
  - working agents are at their desk, the others at a fixed spot in the lounge;
  - there's no walking, no idle routine and no delegation scene;
  - the scene is redrawn once per second.
- A text list of the ten desks and a `role="status"` / `aria-live` banner carry the information for screen readers. The canvas is decorative (`aria-hidden`).
- The legend pairs each name with the color of its character and desk item.

## Security and privacy

- Data stays **100% local**: no network request, neither in the extension nor in the Webview.
- The Webview uses a strict CSP: `default-src 'none'`, a single local script with a nonce, local styles and images only.
- The Webview only receives names, statuses, desks, colors and timestamps.
- The extension never writes to any configuration, session or agent file. It doesn't start or control any agent, and can't create one.

## Limits

- **Copilot**: there is no documented local interface exposing the activity or delegations of a Copilot agent.
- **Claude Code**: the `~/.claude/sessions` registry and the `subagents/*.meta.json` files are internal details, not publicly documented. They were observed with Claude Code 2.1.3xx and may change. If the registry disappears, the extension shows “Unknown status”.
- **Delegations at depth 2 or more** (a subagent launching another): their exact delegating agent can't be identified. These agents show as working, but without a visit or meeting scene.
- **Main session without `--agent`**: when you talk to Claude directly, no defined agent is running, so no desk lights up. The subagents Claude launches do light up, but without a delegating agent on screen.
- Grouping into a meeting assumes the subagents are launched less than 4 seconds apart. Beyond that, each one gets a visit.
- An agent waiting for permission may stay “working” as long as its session is `busy`.
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
  npm run package          # builds agent-office-1.0.0.vsix
  code --install-extension agent-office-1.0.0.vsix
  ```
  You can also use the Command Palette: *Extensions: Install from VSIX…*

Then open the **Agent Office** panel (at the bottom, next to the Terminal). You can also run *Agent Office: Show the agent office*, or click the status bar item.

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
  state/normalize.ts             definitions + signals → working / idle / unknown
  state/slots.ts                 stable rule for the ten desks
  state/placement.ts             role (setting, name, description) → room and desk
  state/summary.ts               answer to “which agent is working?”
  state/snapshot.ts              minimal snapshot sent to the view
  view/officeHtml.ts             Webview page + CSP
  extension.ts                   activation, polling, status bar, view
media/office.js                  office layout, pathfinding, idle routine, delegation scenes, colors, rendering
media/office.css                 banner, accessible legend
```

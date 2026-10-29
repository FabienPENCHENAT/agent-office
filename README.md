<div align="center">

<img src="media/extension-icon.png" alt="Agent Office logo" width="128">

# Agent Office

**See at a glance which of your Claude Code agents is working right now.**

[![Latest release](https://img.shields.io/github/v/release/FabienPENCHENAT/agent-office?label=release&color=4fb06a)](../../releases/latest)
[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![VS Code 1.90+](https://img.shields.io/badge/VS%20Code-1.90%2B-007ACC?logo=visualstudiocode&logoColor=white)
![100% local](https://img.shields.io/badge/data-100%25%20local-8a93a6)

[Getting started](#getting-started) · [How it works](#how-it-works) · [Settings](#settings) · [FAQ](#faq) · [Technical docs](docs/TECHNICAL.md)

<img src="docs/images/office.gif" alt="The pixel-art office: agents at their desks with a “working” bubble, others in a meeting, others by the pond" width="736">

</div>

A tiny pixel-art office inside VS Code. When one of your Claude Code agents starts working, its character walks to its desk. When an agent delegates, the others gather in a meeting room. When a job is done, the result is brought back to whoever asked for it. And when there's nothing to do, everyone heads to the pond or the hammock.

## Features

- **Live status**: see which agent is working, idle or in an unknown state, refreshed every 2 seconds.
- **Real delegations**: visits, meetings and hand-ins are triggered by what your agents actually do.
- **Zero setup**: agents, desks and colors are detected automatically.
- **Private by design**: 100% local and read-only. No code, prompt or conversation is ever displayed.

## Getting started

### 1. Make sure you have custom agents

> [!IMPORTANT]
> **Agent Office shows your Claude Code _custom agents_. No custom agents, nobody in the office.**
>
> A custom agent is a `.md` file in `~/.claude/agents/` (for all your projects) or in your project's `.claude/agents/` folder. You can create them with the `/agents` command in [Claude Code](https://docs.claude.com/en/docs/claude-code/overview).

**No agents yet?** Paste the prompt below into Claude Code. It creates a complete development team of 9 agents, like the one in the animation, with one simple rule: you only talk to the product manager, and no code changes without your explicit “GO”.

<details>
<summary><b>📋 Prompt: create a complete development team (9 agents)</b></summary>

```text
Create a team of 9 Claude Code custom agents for software development, as
Markdown files in ~/.claude/agents/ (create the folder if needed). If a file
with the same name already exists, show it to me and ask before overwriting.

Each file starts with a YAML frontmatter containing: name, description (one
or two sentences saying when to use the agent), tools, model: inherit, and
color. Below the frontmatter, write a complete system prompt in the second
person ("You are the..."): role, responsibilities, how it works step by step,
what it must never do, and the format of its answer. Every agent reads the
project's CLAUDE.md first and follows its rules.

The team works around one rule: the product manager is my only contact, and
no code changes without my explicit "GO". Pushing, merging or deploying needs
a second, separate confirmation from me.

1. product-manager (color: purple)
   My single point of contact. Clarifies each request (need, users, acceptance
   criteria), then delegates to the smallest useful set of agents with the
   Agent tool, never playing their role itself. For any new feature, asks the
   product-challenger first. Consolidates their opinions into one short report
   with a recommendation, then waits for my "GO" before any implementation.
   Writes self-contained briefs (scope, out of scope, files to read, expected
   answer). Never edits files itself.
   tools: Agent(product-challenger, ux-ui-designer, tech-lead,
   developer-frontend, developer-backend, qa-engineer,
   documentation-engineer, administrator), Read, Grep, Glob, Bash,
   AskUserQuestion

2. product-challenger (color: orange)
   Framing partner of the product manager, consulted early for each feature.
   Looks at what comparable products do, then challenges the idea with 2 or 3
   argued, sourced alternatives and recommends a direction. Read-only.
   tools: Read, Grep, Glob, WebSearch, WebFetch

3. ux-ui-designer (color: pink)
   Designs user flows and screens and shows them as self-contained, very
   visual HTML mockups (variants side by side, clickable flow), saved outside
   the repository in ~/.claude/artifacts/<project>/. Never modifies the
   repository.
   tools: Read, Grep, Glob, Write, Edit, Bash

4. tech-lead (color: blue)
   Architecture, feasibility, risks, security, task split and code review.
   Read-only by default; implements a complex part only when the brief
   contains "GO confirmed by the user", in an isolated Git worktree.
   tools: Read, Grep, Glob, Edit, Write, Bash

5. developer-frontend (color: cyan)
   Interfaces, components, mockup integration, interactions, accessibility,
   frontend tests. Before the GO, proposes a plan without changing anything.
   After the GO, implements and tests in an isolated Git worktree.
   tools: Read, Grep, Glob, Edit, Write, Bash

6. developer-backend (color: green)
   APIs, services, business logic, data, integrations, security, backend
   tests. Same two modes as developer-frontend: plan before the GO,
   implementation in an isolated Git worktree after.
   tools: Read, Grep, Glob, Edit, Write, Bash

7. qa-engineer (color: red)
   Acceptance criteria, functional and technical tests, regressions,
   compliance with the design mockups. Before implementation, lists test
   scenarios proportionate to the risk. After, reviews and tests the branch
   without changing the code.
   tools: Read, Grep, Glob, Bash, Write, Edit

8. documentation-engineer (color: yellow)
   Documents the project for the other agents in docs/ai/ (a shared index
   plus one page per role) so they don't have to explore the code again; it's
   its first mission on any project without docs/ai/index.md. Updates it after
   important changes. Only writes in docs/.
   tools: Read, Grep, Glob, Write, Edit, Bash

9. administrator (no color)
   Privileged operations, only when the brief quotes my confirmation word for
   word: merging into the main branch, pushing, cleaning up worktrees and
   branches, editing agent files or Claude Code settings. Never writes
   features, never force-pushes, never rewrites history, never handles
   secrets.
   tools: Read, Grep, Glob, Bash, Edit, Write

When you're done, list the files you created and tell me how to start
working with the team.
```

</details>

### 2. Install the extension

1. Download **`agent-office-x.y.z.vsix`** from the [latest release](../../releases/latest) (under *Assets*).
2. In VS Code, open the **Extensions** view, click the **`···`** menu at the top, choose **Install from VSIX…** and pick the file.
3. Click the **Agent Office** tab at the bottom of VS Code, next to *Terminal*. 🎉

<details>
<summary>Prefer the terminal?</summary>

```bash
code --install-extension ~/Downloads/agent-office-*.vsix
```

</details>

### 3. Put your agents to work

Start Claude Code with one of your agents, for example:

```bash
claude --agent product-manager
```

Ask it for something. As soon as it starts, its character walks to its desk with a 💻 bubble, and the status bar at the bottom of VS Code reads *“Active agent: product-manager”*.

> [!TIP]
> Talking to Claude directly, without `--agent`, doesn't light up any desk for Claude itself. Only the custom agents it launches as subagents show up.

## How it works

Everything is automatic. The extension:

1. **finds your agents** in `~/.claude/agents/` and in the open project's `.claude/agents/`, and shows up to 10 of them;
2. **gives each one a desk** based on its name, or its description when the name says nothing about the role:

   | Name or description mentions… | Desk |
   |---|---|
   | product manager, product owner | Product manager's office |
   | challenger | Challenger's office |
   | UX, UI, design | UX/UI office |
   | anything else | Engineering open space |

3. **gives each one a color**: the `color:` from the agent's file, or else one no other agent is using;
4. **reads Claude Code's local activity files** every 2 seconds to know who's working and who delegates to whom.

Above each character, a bubble tells you what's going on:

| Bubble | Meaning |
|:---:|---|
| 💻 | **Working**, from the moment it starts, even while walking to its desk |
| 👥 | **In a meeting**: an agent delegated to several others at once |
| 📄 | **Handing in its work** to the agent that asked for it |
| ✅ | **Work accepted** by the agent that delegated |
| 💤 ☕ | **Free**: wandering, chatting by the pond, napping in the hammock |
| ❓ | **Unknown**: the character turns grey, its status can't be determined |

## Settings

Everything works out of the box. To customize, open VS Code Settings and search for **Agent Office**.

| Setting | Default | What it does |
|---|---|---|
| `agentOffice.agentRooms` | `{}` | Force an agent's desk, e.g. `{ "my-agent": "design" }` (`pm`, `challenger`, `design` or `engineering`) |
| `agentOffice.pinnedAgents` | `[]` | Agents shown first when you have more than 10 |
| `agentOffice.pollIntervalSeconds` | `2` | Refresh interval, in seconds |

Two more advanced settings are described in the [technical docs](docs/TECHNICAL.md#signal-sources-claude-code).

## Privacy

- **100% local**: the extension makes no network request.
- **Read-only**: it never changes a file and never starts or controls an agent.
- **Nothing of your work is shown**: only agent names, statuses and timestamps reach the office view.

## Known limitations

- **Claude Code only.** GitHub Copilot agents are listed but stay grey: Copilot exposes no activity signal.
- **Relies on Claude Code internals.** Activity is read from local files that Claude Code doesn't officially document. A Claude Code update may break detection; the office then shows “Unknown status” rather than guessing.
- **Tested on macOS.** Linux and Windows should work but haven't been tested yet: feedback welcome.
- **10 agents max** in the office. Extra agents are listed below it.

More details in the [technical docs](docs/TECHNICAL.md#limits).

## FAQ

<details>
<summary><b>My agents have random names and no colors. Can I tidy them up in one go?</b></summary>

Yes. Open Claude Code in your project and paste this prompt:

```text
Look at all my Claude Code agents: the .md files in ~/.claude/agents/ and in
.claude/agents/ of this project. Then:

1. Colors: in each agent's frontmatter, add or update the `color:` line using only
   red, blue, green, yellow, purple, orange, pink or cyan. Give every agent a
   different color. If I have more than 8 agents, leave the extra ones without a
   color. Don't change `name:` or anything else in the files.

2. Rooms for the Agent Office VS Code extension: pick a room for each agent:
   - "pm": the agent that leads, coordinates or talks to me (at most one)
   - "challenger": the agent that criticizes and challenges ideas (at most one)
   - "design": the UX/UI agent (at most one)
   - "engineering": everyone else
   Save the result in my VS Code user settings.json as "agentOffice.agentRooms",
   for example { "lead": "pm", "critic": "challenger" }. Keep my other settings.

3. Show me a table: agent → color → room.
```

Your agents keep their names, so nothing changes in how you call them.
</details>

<details>
<summary><b>My agent is working but its desk stays empty</b></summary>

Check that Claude Code was started with that agent (`claude --agent <name>`), or that the agent was launched as a subagent. Also check that its `.md` file is in `~/.claude/agents/` or in the `.claude/agents/` folder of the project open in VS Code.
</details>

<details>
<summary><b>Can I have fewer animations?</b></summary>

Yes: the office follows VS Code's `workbench.reduceMotion` setting. When it's on, the scene stays still.
</details>

<details>
<summary><b>How do I update or uninstall?</b></summary>

To update, install the new `.vsix` from the [latest release](../../releases/latest) over the old one. To uninstall, find **Agent Office** in the Extensions view and click **Uninstall**.
</details>

## Contributing

Bug reports and ideas are welcome in the [issues](../../issues).

To build from source, you need Node.js 18+:

```bash
npm install
npm test          # runs the test suite
npm run package   # builds the .vsix
```

Press `F5` in VS Code to try your changes in a new window. The [technical docs](docs/TECHNICAL.md) explain the architecture and every rule the office follows.

## Credits and license

Inspired by [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents). The code, the sprites (drawn in code) and the office layout are original.

Released under the [MIT License](LICENSE).

<div align="center">

<img src="media/extension-icon.png" alt="Agent Office logo" width="128">

# Agent Office

**See at a glance which of your Claude Code agents is working right now.**

A tiny pixel-art office inside VS Code where your AI agents work at their desks, meet up, hand in their work… and nap in the hammock when there's nothing to do.

<img src="docs/images/office.gif" alt="The pixel-art office: agents at their desks with a “working” bubble, others in a meeting, others by the pond" width="736">

![VS Code](https://img.shields.io/badge/VS%20Code-1.90%2B-007ACC?logo=visualstudiocode&logoColor=white)
![Claude Code](https://img.shields.io/badge/Claude%20Code-agents-D97757)
![100% local](https://img.shields.io/badge/data-100%25%20local-4fb06a)
![MIT License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

## ✋ Before you start: you need custom agents

> [!IMPORTANT]
> **Agent Office shows your Claude Code _custom agents_. No custom agents, nobody in the office.**
>
> You need:
> - [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) installed;
> - at least one custom agent: a `.md` file in `~/.claude/agents/` (for all your projects) or in your project's `.claude/agents/` folder.

**Already have agents?** Skip to the [install](#-install-in-3-steps).

**No agents yet?** You have two options:

- create them one by one with the **`/agents`** command in Claude Code;
- or create a **complete development team in one go**: open Claude Code, paste the prompt below and let it work. It's the team you see in the animation above.

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

Once the team exists, start Claude Code with **`claude --agent product-manager`** and tell it what you want to build. The product manager delegates to the others, and the office comes alive.

---

## ⚡ Install in 3 steps

> 🕐 About one minute. No account, no key, no setup.

### 1. Download the extension

Go to [**Releases**](../../releases/latest) and download the **`agent-office-x.y.z.vsix`** file (under *Assets*).

### 2. Install it in VS Code

The easiest way: **drag the `.vsix` file onto the Extensions sidebar** in VS Code.

<details>
<summary>Didn't work? Two other ways</summary>

- **From the menu**: open the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux), type **`Install from VSIX`**, then pick the file.
- **From a terminal**:
  ```bash
  code --install-extension agent-office-1.0.0.vsix
  ```

</details>

### 3. Open the office

At the bottom of VS Code, next to the *Terminal* tab, click the **Agent Office** tab. 🎉

> 💡 Can't see it? Command Palette → **`Agent Office: Show the agent office`**.

---

## 🪄 Everything is automatic

There's nothing to configure. On startup, the extension:

1. **finds your agents** in `~/.claude/agents/` (your personal agents) and in the `.claude/agents/` folder of the open project;
2. **gives each one a desk**, based on its name:

   | If the name contains… | It sits… |
   |---|---|
   | `product-manager`, `pm`, `product-owner` | in the product manager's office |
   | `challenger` | in the challenger's office |
   | `ux`, `ui`, `design` | in the UX/UI office |
   | anything else | in the engineering open space |

   If the name says nothing about the role (`alice`, `helper`…), the extension reads the agent's **description** instead. For example, an agent described as a *product owner* still gets the product manager's office.
3. **gives each one a color**: the `color:` set in the agent's file, or else a color no other agent is using;
4. **follows Claude Code live**, every 2 seconds: who's working, who's delegating to whom, who's done.

Add a new agent and it shows up on its own. The office has room for **10 agents**.

> ℹ️ **Good to know**: the extension needs **custom agents** (see [Before you start](#-before-you-start-you-need-custom-agents)). If you talk to Claude directly, without `claude --agent <name>`, no desk lights up. Only the subagents it launches do.

---

## 👀 What you'll see

| Bubble | What the agent is doing |
|:---:|---|
| 💻 | **Working.** The bubble shows up as soon as the agent starts, even while it walks to its desk. |
| 👥 | **Heading to a meeting.** An agent that delegates to several others at once gathers them in a meeting room. |
| 📄 | **Handing in its work.** When it's done, it brings the result to whoever asked for it. |
| ✅ | **Work accepted.** The agent that delegated acknowledges it. |
| 💤 ☕ | **Free.** It wanders around, chats by the pond or naps in the hammock. |
| ❓ | **Unknown status.** The character turns grey: the extension can't tell what it's doing. |

The VS Code status bar (at the bottom) also spells out who's working: *“Active agent: tech-lead”*.

---

## ⚙️ Settings (optional)

Everything works out of the box. To customize: **VS Code Settings → search for “Agent Office”**.

| Setting | What it does |
|---|---|
| `agentOffice.agentRooms` | Force an agent's office. Example: `{ "my-agent": "design" }` |
| `agentOffice.pinnedAgents` | Choose which agents come first when you have more than 10 |
| `agentOffice.pollIntervalSeconds` | How often the office refreshes (2 seconds by default) |

---

## 🔒 Privacy

- **100% local**: no network connection, nothing is sent anywhere.
- **Read-only**: the extension never changes a file and never controls an agent.
- **None of your work is shown**: no code, no conversation, no prompt. Only the agents' names and status.

---

## ❓ FAQ

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

The office updates within a couple of seconds. Your agents keep their names, so nothing changes in how you call them.
</details>

<details>
<summary><b>My agents stay idle even though they're working</b></summary>

Make sure you start Claude Code with an agent (for example `claude --agent product-manager`), or that your agent delegates to subagents. A direct conversation with Claude, without an agent, doesn't light up any desk.
</details>

<details>
<summary><b>Does it work with GitHub Copilot?</b></summary>

Copilot agents are found and shown, but greyed out: Copilot doesn't expose their activity. Only Claude Code is supported for now.
</details>

<details>
<summary><b>I'd like fewer animations</b></summary>

The extension follows VS Code's `workbench.reduceMotion` setting: when it's on, the scene stays still.
</details>

<details>
<summary><b>How do I update?</b></summary>

Download the new `.vsix` from [Releases](../../releases/latest) and install it over the old one, the same way.
</details>

---

## 🛠️ For the curious

<details>
<summary>Build the extension yourself</summary>

You need Node.js 18+ and VS Code 1.90+.

```bash
npm install
npm test          # checks that everything works
npm run package   # builds agent-office-1.0.0.vsix
```

To try it without installing: open the folder in VS Code and press `F5`.
</details>

How it all works under the hood (signals read, placement rules, accessibility, limits) is covered in the [technical documentation](docs/TECHNICAL.md).

<div align="center">

---

Inspired by [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents). The code, the sprites (drawn in code) and the office layout are original.

Released under the [MIT License](LICENSE).

</div>

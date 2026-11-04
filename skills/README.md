# GetCito Skills

A collection of opinionated [Anthropic Skills](https://docs.anthropic.com/claude/docs/skills)
that turn Claude into an AEO analyst with live access to your GetCito
account.

Most skills come in **two flavours**: one that talks to the
[GetCito MCP server](../docs/guides/mcp-server.mdx) (cleaner UX in
clients that support it) and one that calls the REST API directly with
code execution (works anywhere). Pick the flavour that matches your
Claude client — see the table below.

Without a skill, Claude can still hit our tools/API if you tell it
how — it'll just answer generically. With one of these installed, it
behaves like an AEO analyst who's been on your account for six months.

## Skills in this repo

| Skill | Flavour | What it's for |
| --- | --- | --- |
| [`getcito-aeo-coach`](./getcito-aeo-coach) | **MCP (preferred)** | Brand snapshots, visibility deep-dives, competitor watch, citation sources, prompt coverage and prompt suggestions, Action Center (what to do next, did it work, sending Improve suggestions), mentions and sentiment (how AI talks about the brand, why sentiment moved, what AI associates it with), Content Editor drafts (sources, suggestions for review, Mark ready, what the live page earns), saved reports. Use this when your client (Claude Desktop, Claude Code, Cursor, Zed) is connected to the GetCito MCP server. |
| [`getcito-aeo-coach-standalone`](./getcito-aeo-coach-standalone) | **REST (fallback)** | Same skill, no MCP needed. Use this when you're on claude.ai web without a Connector, or any surface where setting up MCP isn't an option. |

## GetCito skills (Chat)

Chat in GetCito uses the twenty-one skills below. Each is one `SKILL.md` in
the [Agent Skills](https://agentskills.io/specification) format:
instructions only, no scripts or reference files. Chat lists their names and
descriptions, and loads a skill's text when it picks the skill or when you
start a message with its `/name`.

| Skill | Title |
| --- | --- |
| [`winback`](./winback) | Win back lost citations |
| [`tasks`](./tasks) | Complete this week’s tasks |
| [`quality`](./quality) | Quality pass |
| [`faq`](./faq) | FAQ from fan-outs |
| [`report`](./report) | Weekly report |
| [`beat`](./beat) | Beat a competitor |
| [`refresh`](./refresh) | Refresh for this year |
| [`publish`](./publish) | Ready to publish |
| [`shopping`](./shopping) | AI shopping readiness |
| [`wrongclaim`](./wrongclaim) | Fix wrong claims about us |
| [`answerfirst`](./answerfirst) | Answer-first rewrite |
| [`facts`](./facts) | Brand facts check |
| [`compare`](./compare) | Comparison page |
| [`translate`](./translate) | Translate a page |
| [`questions`](./questions) | Buyer questions |
| [`features`](./features) | How AI compares us |
| [`gaps`](./gaps) | No clear leader |
| [`markets`](./markets) | Who AI recommends by market |
| [`listings`](./listings) | Listing gaps |
| [`rivals`](./rivals) | Rival brief |
| [`audit-fix`](./audit-fix) | Site audit fixes |

### Shortcut playbooks

Chat's `/` menu shortcuts each have a playbook here too: a `SKILL.md` marked
`metadata.hidden: "true"`, named after its command. Chat never lists them as
skills; it loads one only for a message sent with its shortcut, and that
answer reads only the tools in the playbook's `metadata.reads`.

| Playbook | Shortcut |
| --- | --- |
| [`start`](./start) | Get started |
| [`analyze`](./analyze) | Analyze |
| [`new-report`](./new-report) | Reports |
| [`create`](./create) | Create content |
| [`optimize`](./optimize) | Optimize content |
| [`opportunities`](./opportunities) | Find opportunities |
| [`audit`](./audit) | Improve with audit |

CI checks every one of them (`frontend/src/lib/chat/skills/library.test.ts`):
the front matter (`name` matches the folder, `description` up to 1,024
characters, `metadata.title` and `metadata.filters`, `license: MIT`), a body
of at most 500 lines, the tool names Chat has (for a playbook, `metadata.reads`
names read tools only, and its title is its shortcut's), and a scan that refuses email
addresses, prices, tracking parameters, hidden characters, base64 blobs,
secrets and text that tries to override Chat's rules. A skill shapes how
Chat does a task; it never changes what Chat may do, skips an approval or
publishes anything. After changing one, run `yarn test -u src/lib/chat/skills`
in `frontend/` and commit `library.json`, which Chat reads.

## Which flavour should I install?

| Your client | Recommended |
| --- | --- |
| Claude Desktop | **MCP** — install the [MCP server](../docs/guides/mcp-server.mdx) once, then `getcito-aeo-coach` |
| Claude Code | **MCP** — same as above |
| Cursor / Zed / other MCP-aware tools | **MCP** — it's their native primitive |
| claude.ai web with the GetCito Connector configured | **MCP** |
| claude.ai web without a Connector | **Standalone** — single install, no extra setup |
| Anywhere else with Skills + code execution | **Standalone** |

Both flavours hit the same data, format the same way, and share the
same `references/` knowledge files. The difference is just _how_ Claude
fetches numbers — typed tool calls vs. inline Python HTTP requests.

## Prerequisites

You need an **GetCito API key** in either flavour:

1. Open your GetCito dashboard → **Settings → MCP & API Keys**
2. Click **New key**, give it a memorable name (e.g. _Claude — laptop_)
3. Copy the token (`getcito_...`). It's shown **once** — store it in your
   password manager

If you self-host GetCito, both flavours work against your own instance
— you'll just provide a different base URL when prompted (MCP: in your
client config; standalone: when the skill asks).

## Install

Skills are just markdown files — they work in any Claude surface that
supports the Skills feature.

### Claude.ai (web)

1. Open <https://claude.ai/skills>
2. Click **New Skill** → **Paste from markdown**
3. Paste the contents of your chosen flavour's `SKILL.md`
4. Save

The first time you use the MCP flavour, you also need the **GetCito
Connector** added to your Claude.ai account (see the MCP guide). The
standalone flavour will ask you for your API key in the conversation
itself.

### Claude Code / Claude Desktop

```bash
git clone https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool.git getcito
cp -r getcito/skills/getcito-aeo-coach ~/.claude/skills/   # MCP flavour
# or
cp -r getcito/skills/getcito-aeo-coach-standalone ~/.claude/skills/
```

Restart your Claude client and the skill is live. If you chose the MCP
flavour, also configure the
[GetCito MCP server](../docs/guides/mcp-server.mdx) in your client.

## Use

Once installed, just ask in plain English:

- _"How is my brand doing this week?"_
- _"Why did visibility drop on ChatGPT?"_
- _"Who are my biggest competitors right now?"_
- _"Which sites does AI cite instead of us?"_
- _"What should we work on next — and did last month's actions work?"_
- _"Give me a 30-second standup on the Acme brand."_
- _"Why did our sentiment drop on Gemini?"_
- _"What's waiting for review in the Content Editor?"_

Claude picks the right tools / endpoints, fills in filters, interprets
the numbers, and answers with action items. Tools that change your
account (accepting a suggestion, updating a task, sending Improve
suggestions to Action Center, running a page audit, correcting a
response's sentiment, writing a draft or suggestions in the Content
Editor, marking a draft ready) are only used when
you ask for that specific change.

## Contributing

Every folder under `skills/` other than the two AEO coach flavours is one of
Chat's GetCito skills or shortcut playbooks, and CI checks it as one. So
there are two kinds of contribution:

**A skill for Chat.** GetCito's own skills are the twenty-one listed above.
Adding one (or changing one) means, in the same PR:

```
skills/
  your-skill-name/
    SKILL.md           # front matter + body, nothing else: no references/ or scripts/
```

- `name` is the folder's name (lowercase, digits, single hyphens); add it
  to the list in `frontend/src/lib/chat/skills/library.test.ts` and to
  `SKILL_ORDER` in `frontend/src/lib/chat/skills/library.ts`.
- `description` says what it does in one line; `metadata.title` and
  `metadata.filters` (content, visibility, product, technical, reports); `license: MIT`.
- The body names only tools Chat has (`frontend/src/lib/chat/registry`), and
  never asks Chat to skip an approval, publish, or send anything.
- Refresh `library.json` with `yarn test -u src/lib/chat/skills` in `frontend/`
  and commit it.

**Your own or a third-party skill.** Skills from elsewhere won't be added
to this folder: Chat will import them (upload or a GitHub link), clean them
to instructions only, scan them and have an Admin approve them, in a later
release.

**An AEO coach skill** for Claude clients goes in its own folder with its
`references/`, and joins the AEO coach list in
`frontend/src/lib/chat/skills/library.test.ts`, which leaves those out. It still
gets a row in the table at the top, and CI still scans every file in it for
hidden characters, secrets, email addresses and base64 blobs, as it does
every file in this folder (`frontend/src/lib/chat/skills/publicSkills.test.ts`).
A few principles we follow for those:

- **Skills layer knowledge, not data.** Data comes from the MCP server
  or the matching REST endpoint. A skill's job is to know _when_ and
  _how_ to use it.
- **Be opinionated about output.** Marketers don't want a CSV dump —
  they want a 3-line summary, a delta, and a suggested next step.
- **Ship MCP and standalone flavours together when it makes sense.**
  Users on different surfaces shouldn't have to fork the skill
  themselves.
- **Handle errors gracefully.** Missing tool / bad key / empty data →
  tell the user, don't fabricate.
- **Don't echo API keys.** In the standalone flavour, hold tokens in
  execution memory and redact them in any output.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for branch naming, commit
conventions, and PR workflow.

## License

[MIT](../LICENSE) — part of [GetCito](https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool).

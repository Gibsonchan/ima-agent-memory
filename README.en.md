# ima-agent-memory

## Give your agents one shared brain

**Switch agents without explaining your project all over again.**

Plan in Codex, organize material in WorkBuddy, then continue in another agent.
Your project goals, preferences and confirmed decisions should travel with you.
ima-agent-memory keeps them in one maintained, project-scoped memory that agents
can read and contribute to through a Skill, MCP or the CLI.

It helps when context is scattered across long chats, decisions get lost during
handoffs, or moving between computers means rebuilding the same background.
The shared brain is a common memory: submissions remain candidates until reviewed
and incorporated into a maintained summary. A private local home works on one
machine; optional ima snapshots let other configured machines read those summaries.

[中文](README.md) · [Integration and maintenance](docs/integration.md) · [Security](SECURITY.md)

Requires Node.js 22+. No runtime npm dependencies. Runtime data lives outside the
source repository. Initialization creates empty templates: it does not import chat
history, connect an account or upload anything.

## Agents and integration scope

| Agent / client | Integration route | Deliverable |
| --- | --- | --- |
| Codex | MCP stdio or CLI plus startup rules | Generic MCP configuration generator and AGENTS snippet |
| WorkBuddy | Skill ZIP / CLI; optional MCP configuration | Self-contained skill with offline packaging checks |
| DeepSeek Harness (DSH) | stdio MCP client plugin or CLI | Generic server; configure for the installed DSH version |
| Claude Code | Local stdio MCP or CLI | Generic integration route; client validation pending |
| Cursor | Local stdio MCP or CLI | Generic integration route; client validation pending |

This public version has not been end-to-end tested in every listed client. Local
CLI operations, MCP protocol exchange, extracted skill execution and Windows/Linux
CI are verified. WorkBuddy UI import and individual client versions still need
validation. See [integration scope and official references](references/agents.md).

For example, an agent proposes a sourced project decision, a maintainer verifies it
and updates the summary, and another configured agent reads that same summary when
it takes over. Startup instructions must request memory reads; other machines see
cloud changes after synchronization.

For WorkBuddy, import the release's `ima-agent-memory-workbuddy-v0.1.1.zip` through
Skills → Add Skill → Upload Skill. It includes a root-level `SKILL.md`, runtime
code and empty templates; Node 22+ is still required. Importing it does not run
initialization or upload data. See [integration notes](references/workbuddy.md).
Build it with `node scripts/build-skill.cjs --output <ZIP-outside-repository>`.

## Local quick start

Download and extract this repository, then run from its directory:

```sh
node bin/ima-agent-memory.cjs init
node bin/ima-agent-memory.cjs current --project demo
node bin/ima-agent-memory.cjs record --file examples/event.json
node bin/ima-agent-memory.cjs queue
node bin/ima-agent-memory.cjs search "two languages" --project demo --include-candidates
```

These commands work offline. The event is fictional. The default private data home
is `~/.local/share/ima-agent-memory` on all platforms, including Windows. Override it
with `--home DIRECTORY` or `IMA_MEMORY_HOME`; keep it outside the source repository.
`init` prints the actual location and refuses to replace existing configuration.

Edit the private `config.json` to register projects. Maintain canonical Markdown in
`curated/projects/<id>.md`. Project IDs use lowercase letters, digits, `_` and `-`.
Search requires a project, or explicit `all`. Candidates are excluded by default.
Agent labels and evidence types are self-reported, not authenticated identities.

## MCP

Run `node bin/ima-agent-memory.cjs mcp-config` to generate configuration containing
your actual local paths. Merge it using your client's documented configuration
format; do not commit the generated config. Add the reading rules from
[examples/AGENTS-snippet.md](examples/AGENTS-snippet.md) to the agent's instructions.

Tools: `memory_current`, `memory_read`, `memory_search`, `memory_record_event`.
The last writes candidates only. Memory does not confer authorization or resolve
concurrent changes to business code. This stdio server supports initialize-based
MCP revisions through `2025-11-25`; it does not implement HTTP or the `2026-07-28`
lifecycle. Client-specific compatibility must be checked by the user.

## Optional ima backend

Obtain your own credentials and knowledge-base ID from the
[official ima interface](https://ima.qq.com/agent-interface). Install the official
ima-skill separately and set `IMA_SKILL_DIR` to its absolute directory containing
`ima_api.cjs`. The official skill is not redistributed by this project.

Configure credentials using `IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY` or the
official skill's files at `~/.config/ima/client_id` and `~/.config/ima/api_key`.
Never put credentials in source, events or chat. In your private `config.json`, set
`knowledge_base_id` to your own KB, keeping `backend` as `local` initially.

```sh
node bin/ima-agent-memory.cjs sync
node bin/ima-agent-memory.cjs sync --apply
```

The first command is an offline preview. `--apply` uploads all Markdown under the
private home's `curated/`, including candidates. Review it first. Common secret
patterns are blocked, but heuristic checks cannot guarantee privacy. Documents
include readable text and a checksummed Base64 payload. Base64 is not encryption.
Split documents larger than 64 KiB; ima may impose additional limits.

Snapshots are hash-deduplicated and read back before CURRENT is published last.
Failures preserve resumable local state without advancing the success watermark.
Old snapshots are retained, and deleting local files does not erase cloud history.
Retries after an ambiguous network failure may create duplicate snapshots.

After the first successful sync, set `backend` to `ima` and restart the MCP server.
Readers then use cloud snapshots; submissions go to the space's cloud inbox.
The maintainer runs `pull-inbox` and `queue`, verifies sources, manually updates
canonical summaries, then syncs again. Local reviews require a source and note;
they neither update summaries nor synchronize review status automatically.

To share a space, use the same namespace, memory-space UUID, knowledge-base ID and
project list, with separately provisioned credentials. Use **one publishing
maintainer**: locks are local to one data home, not distributed across machines.

## Checks

```sh
node --test
node scripts/check-privacy.cjs
```

Tests use synthetic fixtures, temporary homes and a fake ima API. CI targets Linux
and Windows with Node 22 and 24. Live credentials, permissions, service quotas and
indexing delays need account-specific verification. This public version was not
tested by writing to a maintainer's private knowledge base.

MIT licensed. Independent community project, not an official Tencent product.

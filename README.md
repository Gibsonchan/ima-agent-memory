# ima-agent-memory

## 让你的 Agent，共享同一个大脑

**换个 Agent，不必从头交代项目背景。**

在 Codex 里讨论了方案，用 WorkBuddy 整理资料，再换一个 Agent 接着做——
你的项目目标、偏好、已经确认的决定，也应该一起接过去。

ima-agent-memory 把这些上下文沉淀成一份按项目维护的长期记忆，
通过 Skill、MCP 或命令行供不同 Agent 按需读取和提交。
工具可以换，项目记忆不用重来。

[English](README.en.md) · [接入与维护](docs/integration.md) · [隐私与边界](SECURITY.md)

## 你是否也遇到过

- **换个 Agent，又要重新介绍一遍项目。** 背景、约束、偏好，每次都从头解释。
- **同一个项目，各个 Agent 各记各的。** 这边刚确认的决定，交给另一个工具时又要手动转述。
- **聊过很多次，却找不到为什么这样决定。** 关键信息散落在长对话里，下一次接手还得重新翻。
- **切换电脑，项目上下文也跟着断开。** 希望在不同设备上接续维护好的项目记忆。

这里的“同一个大脑”指**同一份有来源、可维护的项目记忆**：
每个 Agent 读取已整理的结论，新发现先作为候选保留，核对后再进入统一摘要。
本机可共用私有记忆目录；跨设备可选同步到自己的 ima 知识库。

## 面向哪些 Agent

| Agent / 客户端 | 接入方式 | 当前交付范围 |
| --- | --- | --- |
| **Codex** | MCP stdio 或 CLI，加项目启动规则 | 提供通用 MCP 配置生成器与 AGENTS 规则片段 |
| **WorkBuddy** | 导入 Skill ZIP，通过 CLI 使用；也可配置 MCP | 提供自带运行代码的技能包，已完成离线打包验证 |
| **DeepSeek Harness（DSH）** | MCP stdio 客户端插件或 CLI | 提供通用 stdio 服务，需按 DSH 版本配置 |
| **Claude Code** | 本地 MCP stdio 或 CLI | 提供通用接入路径，待该客户端实测 |
| **Cursor** | 本地 MCP stdio 或 CLI | 提供通用接入路径，待该客户端实测 |

这些是可采用的接入方式，公开版本尚未逐个完成上述客户端的端到端验证。
目前已验证本地 CLI、MCP 协议交互、技能包解压运行与 Windows/Linux CI；
WorkBuddy 界面导入和各客户端的具体版本仍需验证。
接入前提和官方文档见 [Agent 接入范围](references/agents.md)。

## 一次接力是什么样

以一个虚构的网站项目为例：

1. 在 Codex 里确定“先完成移动端体验”，提交带来源的候选记录。
2. 维护者核对后，把决定写入该项目的统一摘要。
3. WorkBuddy 接手整理需求时，读取同一份摘要，沿用已经确认的方向。
4. 换到 Claude Code、Cursor 或 DSH 继续工作时，配置读取同一记忆空间，按规则恢复项目背景。

不同 Agent 按各自能力工作，共享已经整理好的项目上下文。
读取规则需要加入客户端的启动指令；云端模式要完成同步后其他设备才会看到更新。

代码和个人记忆分开存放。首次初始化生成空白模板，不自动导入聊天历史或上传内容。
Node.js 22 或更高版本；没有 npm 运行时依赖。

## WorkBuddy 技能包

本仓库包含 [SKILL.md](SKILL.md)，可通过发行时提供的
`ima-agent-memory-workbuddy-v0.1.1.zip` 导入 WorkBuddy：技能 → 添加技能 → 上传技能。
ZIP 根目录直接包含 SKILL.md，并自带运行代码和空白模板；无需访问 GitHub 或 npm install。
需要使用者环境提供 Node.js 22+。ima 云端模式另需使用者自己的凭证和官方 ima-skill。
导入不会自动运行初始化或上传数据，使用说明见 [WorkBuddy 接入](references/workbuddy.md)。

自行打包：`node scripts/build-skill.cjs --output <仓库外的ZIP路径>`。
技能文件和账号/记忆数据分开，升级或卸载技能不删除私有记忆。

## 怎样维护这份共享记忆

- 多个 agent 按同一项目读取维护好的摘要，减少重复交代背景。
- 关键记录保留项目、提出者、主题、来源、日期和证据类型，接手时可以追溯。
- 候选与正式摘要分开；相同主题可以一起核对，不按 agent 数量投票。
- 搜索必须指定项目；跨项目需显式使用 `all`。
- 可把快照同步到自己的 ima 知识库，用 CURRENT 索引定位当前版本。

它不自动判断事实真伪，也不协调多个 agent 对业务代码的并发修改。MCP 连接成功后，仍需把读取规则加入客户端的启动指令。

## 五分钟本地试用

从本仓库下载 ZIP 并解压，或克隆仓库，然后在仓库目录执行：

```sh
node bin/ima-agent-memory.cjs init
node bin/ima-agent-memory.cjs current --project demo
node bin/ima-agent-memory.cjs record --file examples/event.json
node bin/ima-agent-memory.cjs queue
node bin/ima-agent-memory.cjs search "two languages" --project demo --include-candidates
```

以上命令全程离线。`examples/event.json` 是虚构的文档项目决定，仅供演示。

默认数据目录为当前系统用户的 `~/.local/share/ima-agent-memory`，Windows 的 `~` 同样表示用户目录。可在每个命令加 `--home <私有数据目录>`，或设置 `IMA_MEMORY_HOME`。不要把这个目录放到代码仓库中。`init` 输出实际目录，不覆盖已有初始化。

打开数据目录里的 `config.json` 可修改项目清单；摘要在 `curated/projects/<项目ID>.md`。自定义初始化：

```sh
node bin/ima-agent-memory.cjs init --home /path/to/private-memory --project website --name "Website"
```

项目 ID 使用小写英文字母、数字、`_`、`-`。修改项目配置后重启 MCP 服务；为新增项目自行建立对应摘要。

## 接入 MCP 客户端

生成包含本机实际路径的配置，然后按客户端要求合并到它的 MCP 配置中：

```sh
node bin/ima-agent-memory.cjs mcp-config
```

通用格式见 [示例](examples/mcp-client.example.json)。不要把生成的配置提交到公开仓库。把 [启动规则片段](examples/AGENTS-snippet.md) 加入 agent 的启动指令。工具如下：

| 工具 | 用途 |
| --- | --- |
| `memory_current` | 当前文档索引，可按项目过滤 |
| `memory_read` | 读取索引中的一个文档路径 |
| `memory_search` | 搜索当前版本，默认排除候选 |
| `memory_record_event` | 提交带来源、等待核对的候选 |

提供本机 stdio 服务，支持 `2024-11-05` 至 `2025-11-25` 的初始化式 MCP 协议；未实现 HTTP 服务或 `2026-07-28` 的新协议流程。不对任意客户端的兼容性作保证。

## 启用自己的 ima

本地模式无需 ima。云端模式需要自己的 ima OpenAPI 凭证、具有写入权限的知识库，以及单独安装的**官方 ima-skill**。本项目不打包或重新授权官方 skill。入口：[ima OpenAPI / 凭证管理](https://ima.qq.com/agent-interface)。

1. 从官方入口获取 skill，把 `IMA_SKILL_DIR` 设置为包含 `ima_api.cjs` 的绝对目录。
2. 按官方 skill 说明配置 `IMA_OPENAPI_CLIENTID`、`IMA_OPENAPI_APIKEY` 环境变量，或使用 `~/.config/ima/client_id` 和 `~/.config/ima/api_key`。密钥不要放进本项目、事件 JSON 或聊天正文。
3. 在**私有数据目录**的 `config.json` 中，填写自己的 `knowledge_base_id`。先保持 `backend: "local"`，检查模板和待同步内容。
4. 预览并显式发布：

```sh
node bin/ima-agent-memory.cjs sync
node bin/ima-agent-memory.cjs sync --apply
```

`sync` 默认只列计划，不联网；`--apply` 会把本地 `curated/` 下的全部 Markdown（包括候选）上传到指定 ima。同步前检查常见密钥模式；这不能检测所有隐私。请先自行审阅。正文会同时保存可读文本和用于完整性校验的 Base64 封装；Base64 **不是加密**。单个本地文档最多 64 KiB，实际服务限制仍以 ima 为准。

同步按哈希跳过未变文档，写入后读回校验，最后发布 CURRENT。中断后利用本机状态继续；失败不会推进成功水位。旧快照保留，移除本地文件不会删除云端历史。请求已经送达但响应丢失时，重试仍可能产生重复快照。

首次同步成功后，设 `backend: "ima"`，重新启动 MCP 客户端，读取与候选提交会使用 ima。维护者运行 `pull-inbox` 下载候选到本机，之后运行 `queue` 核对。

两台机器共享时，要使用相同的 `namespace`、`memory_space_id`、`knowledge_base_id` 和项目清单，各自配置凭证。只由**一台维护机**发布正式快照；其他机器可以读和提交候选。不同数据目录的锁不互通，不能防止两台维护机同时覆盖 CURRENT。更多说明见 [接入与维护](docs/integration.md)。

## 核对候选

```sh
node bin/ima-agent-memory.cjs queue
node bin/ima-agent-memory.cjs review <事件ID> --status accepted --note "Checked against the original source" --source "Reference to the evidence"
```

支持 `accepted`、`rejected`、`conflict`、`superseded`。Review 是本机维护记录，**不会自动改正式摘要，也不会自动同步 review 状态**。核实后由维护者更新 `curated/projects/` 或 `curated/decisions/<项目>/` 的 Markdown，保留日期和来源，再同步。新的候选始终保留为原始证据。

## 验证与贡献

```sh
node --test
node scripts/check-privacy.cjs
```

测试只使用临时目录和虚构数据；ima API 通过模拟服务验证失败恢复、范围隔离、读回和 CURRENT 顺序。CI 配置覆盖 Windows / Linux、Node 22 / 24。真实 ima 账号的认证、权限、索引延迟和服务限额需要使用者自行验证；本公开版本没有写入维护者的私人知识库做测试。

贡献前阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。MIT License；非腾讯官方项目。

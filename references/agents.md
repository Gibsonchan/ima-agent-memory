# Agent 接入范围与验证状态

“让你的 Agent 共享同一个大脑”指多个客户端读取同一份维护好的项目记忆，
并提交有来源的候选记录。各 Agent 的模型、上下文窗口和执行环境仍各自运行。
维护者核对候选、更新统一摘要；云端模式同步后，其他设备读取新版本。

## 共同前提

- 使用 Node.js 22+，有权访问选定的私有记忆目录。
- 可以运行本机 CLI，或配置本地 MCP stdio 服务。
- 同一台电脑上的客户端指向同一个 IMA_MEMORY_HOME；跨设备使用相同记忆空间配置和各自的 ima 凭证。
- 启动规则明确要求先读取入口、偏好和对应项目摘要，必要时再搜索。

生成通用 MCP 配置：

```sh
node scripts/memory.cjs mcp-config
```

将输出中的 command、args、env 转成目标客户端要求的配置格式。无需 MCP
时也可直接运行 scripts/memory.cjs。命令路径须相对于已安装技能定位，
不能把发布者的本机路径复制给使用者。

## Codex

本项目提供 MCP stdio 服务、配置生成器以及 examples/AGENTS-snippet.md。
把读取规则放入适当作用域的 AGENTS.md，并按当前客户端格式注册 MCP。
配置内容由使用者生成，不在本技能中预置个人路径、账号或记忆。

## WorkBuddy

提供包含 SKILL.md 和完整运行代码的 ZIP，导入后可通过技能执行 CLI。
也可使用客户端自己的 MCP 配置入口接入同一服务。
离线安装结构和运行已验证；客户端界面导入、安全扫描与市场审核尚未实测。

官方说明：[技能导入](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills)。

## DeepSeek Harness（DSH）

可采用官方 dsh-mcp-client 的 stdio 路径，或在有命令执行权限的环境使用 CLI。
使用者需要按自己安装的 DSH 版本配置插件，不能直接照抄其他客户端的配置文件。
此处是依据官方接口文档提供的通用接入路径，尚未完成公开版本的 DSH 端到端验证。

官方说明：[DSH MCP 客户端](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)。

## Claude Code 与 Cursor

两者的官方文档均提供本地 MCP stdio 接入方式，可据此配置本服务；
有本机命令执行权限时也可使用 CLI。此处属于接口兼容路径，尚未逐客户端实测。

官方说明：[Claude Code MCP](https://code.claude.com/docs/en/mcp)、
[Cursor MCP](https://cursor.com/docs/mcp)。

## 目前验证了什么

本地 CLI、四个 MCP 工具的协议交互、候选与正式摘要分离、技能 ZIP 解压运行，
以及 Windows/Linux 的 Node 22/24 CI 已验证。云端 API 的失败恢复与范围隔离
使用模拟服务测试；使用者自己的 ima 账号、权限和限额需在各自环境核对。
不能把这些检查写成“所有 Agent 零配置兼容”或“已经自动同步全部聊天记录”。

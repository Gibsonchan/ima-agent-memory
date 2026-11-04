## 让你的 Agent，共享同一个大脑

这是 v0.1.1 的正式下载发行，提供独立的 WorkBuddy 技能 ZIP、安装说明和校验清单。

### 下载哪个文件

- **ima-agent-memory-workbuddy-v0.1.1.zip**：WorkBuddy 技能包，ZIP 根目录直接包含 SKILL.md，内含运行代码、空白模板和虚构示例。
- **INSTALL.md**：安装步骤、环境要求与当前限制。
- **SHA256SUMS**：技能 ZIP 和安装说明的 SHA-256 校验值。

需要 Node.js 22+；无需 npm install。本地模式不需要账号或网络。
连接 ima 时，由使用者配置自己的官方 ima-skill、凭证与知识库。
发行附件不包含维护者的真实记忆、账号配置、聊天记录或同步状态。

### 功能与接入

按项目维护共享记忆，候选保留来源，经核对后进入统一摘要。
提供 Skill、MCP stdio 和 CLI 接入方式，说明覆盖 Codex、WorkBuddy、DSH，
以及 Claude Code、Cursor 的通用接入路径，并分别标明验证范围。

本发行由 GitHub Actions 从所指向的源码构建，在发布附件前运行测试和隐私检查。
通用协议和离线测试不代表所有客户端已经完成端到端验收；尚未经过 SkillHub 平台审核。

### 已知问题

云端同步时若有其他进程修改本地文档，可能出现索引与正文版本不一致，后续读取报
Cloud document revision mismatch。v0.1.1 尚未修复；同步期间请暂停修改本地 curated 文档。
本地模式可先使用。只由一台维护机发布云端快照；旧快照不会自动删除。

WorkBuddy 导入时请选择专用技能附件，GitHub 自动生成的 Source code ZIP 为源码归档。

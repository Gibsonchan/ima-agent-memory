# 安装 ima-agent-memory v0.2.0

让你的 Agent，共享同一个大脑。

## 下载和导入 WorkBuddy

1. 从本 Release 下载 `ima-agent-memory-workbuddy-v0.2.0.zip`，这是技能安装包。
2. 在 WorkBuddy 中选择「技能 → 添加技能 → 上传技能」，选择这个 ZIP，并完成客户端的安全检查。
3. 首次调用可说：“使用 ima-agent-memory 检查环境，初始化一个本地 demo 项目，再记录一条虚构决定并搜索验证。”

运行需要 Node.js 22 或更高版本；本包不包含 Node 安装程序，无需 npm install。
本地模式无需账号或网络。导入技能只安装文件，不自动初始化或上传内容。
通用代码、空白模板和虚构示例均在包内；私有记忆应保存在技能目录外。

GitHub 自动提供的 Source code ZIP 是源码归档。WorkBuddy 导入请选上面带
`workbuddy-v0.2.0.zip` 的专用附件，其根目录直接包含 SKILL.md。

## 校验下载

同时下载本 Release 的 `SHA256SUMS`。它包含技能 ZIP 和本安装说明的 SHA-256。
可以用系统的 SHA-256 工具计算文件哈希，并与清单中对应文件的一行比较。
例如 PowerShell：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\ima-agent-memory-workbuddy-v0.2.0.zip
```

## 接入其他 Agent 或 ima

技能目录内运行 `node scripts/memory.cjs mcp-config` 可生成本机 MCP 配置。
按照对应客户端要求接入，并添加读取记忆的启动规则。

ima 云端模式另需使用者自己的官方 ima-skill、OpenAPI 凭证和知识库。
入口：https://ima.qq.com/agent-interface。凭证不要放到技能、记忆正文或聊天里。

完整说明：https://github.com/Gibsonchan/ima-agent-memory

## 从 v0.1.1 升级云端模式

在维护机保留原记忆目录，升级技能后执行 `sync --apply` 发布签名索引。
在维护机运行 `trust-export`，将其 JSON 输出通过可信渠道传给其他设备。
其他设备升级后运行 `trust-import --file PUBLISHER.json` 并重启 MCP 连接。
这些命令都通过 `node scripts/memory.cjs` 调用。本地模式使用原记忆目录直接升级。

## 当前验证范围

已验证本地 CLI、MCP 协议交互、ZIP 解压运行及 Windows/Linux CI。
各客户端端到端接入、WorkBuddy 界面导入与 SkillHub 审核仍需实测。

云端的签名校验、候选隔离和同步恢复使用模拟服务验证。新候选由维护者核对后进入统一摘要。

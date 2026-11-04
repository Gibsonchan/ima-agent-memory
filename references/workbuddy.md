# WorkBuddy 安装、接入和可选云端模式

## 导入这个技能

在 WorkBuddy 的技能页面选择「添加技能 → 上传技能」，选择
`ima-agent-memory-workbuddy-v0.1.1.zip`，完成客户端的安全检查后导入。
不同版本的界面标签可能略有不同。

导入 ZIP 只安装文件，不会运行初始化或上传任何记忆。第一次调用时，
技能通过 `scripts/doctor.cjs` 检查环境，并在用户要求开始使用时初始化。
本地模式不需要账号、凭证或网络。Node.js 22+ 需由使用者的环境提供。

官方导入说明：
https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills

## 其他 agent 的 MCP 接入

```sh
node scripts/memory.cjs mcp-config
```

输出包含本机实际路径，按目标客户端的格式合并，不覆盖其他 MCP 配置，
不要提交到公开仓库。无需 MCP 时可继续通过本技能的 CLI 使用记忆。
把 [examples/AGENTS-snippet.md](../examples/AGENTS-snippet.md) 的规则加入
目标 agent 的启动指令；只在用户要求接入时修改对应配置。

本机 stdio MCP 提供 memory_current、memory_read、memory_search、
memory_record_event；支持初始化式 MCP 协议到 2025-11-25。
不同客户端的格式与兼容性仍需实际检查。

## 可选 ima 配置

安装官方 ima-skill，入口为 https://ima.qq.com/agent-interface。
设置 IMA_SKILL_DIR 为包含 ima_api.cjs 的绝对目录。按照官方说明配置
IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY 环境变量，或官方用户凭证文件。
让用户在自己的环境中配置，不要求把密钥贴到对话里。

在私有记忆目录的 config.json 里填写用户自己的 knowledge_base_id，
先保持 backend=local，核对待同步内容后执行：

```sh
node scripts/memory.cjs sync
node scripts/memory.cjs sync --apply
```

第二条会真正上传数据，只在用户要求同步的范围内执行。先检查全部
curated/ Markdown，包括候选。每个文档最多 64 KiB；服务限制仍以 ima
响应为准。写入后读回校验，最后发布 CURRENT，失败不推进成功水位。
如果 helper 要求更新或 API 报错，解决该错误后再重试，不宣称已同步。

首次同步成功后设置 backend=ima，重启使用该配置的 MCP 服务。
维护机运行 pull-inbox，再用 queue 核对云端候选。
多个客户端共用相同 namespace、memory_space_id、knowledge_base_id
和项目清单，分别配置凭证。只有一台维护机发布正式快照；本机锁不跨设备。
旧云端快照不会自动删除，本地删除文件不等于删除历史。

## 公开上架与本地导入的区别

上传到自己的 WorkBuddy 只安装到自己的技能库；在 SkillHub 发布还需要
发布者账号、表单信息和平台审核。需要填写名称、简介、版本、许可证时，
可使用发行文件旁的上架信息文档；发布者使用自己的账号和身份。
公开代码或技能不会公开使用者的记忆空间，数据权限由其本机与 ima 决定。

本包使用通用 name/description frontmatter。SkillHub CLI 另外要求
slug/displayName/version/summary 字段，不能直接把本包描述成已通过
SkillHub CLI 的发布预检；网页上传和 CLI 发布是两种不同入口。
CLI 发布时按当时官方规范准备副本：https://www.skillhub.cn/tutorials。

本包已做格式与本地解压运行检查，仍需 WorkBuddy 或 SkillHub 实际导入、
扫描与审核。不要跳过平台给出的安全检查，也不要宣称已上架或审核通过。

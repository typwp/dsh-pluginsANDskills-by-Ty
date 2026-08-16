# dsh-pluginsANDskills-by-Ty

> 📌 **个人使用项目**：本仓库是 Ty 的个人 DSH 部署集合，随个人需求迭代维护，**非正式开源维护项目**。
> 代码开放、欢迎参考与自取，但不作稳定性/兼容性承诺 —— 部署前请自行测试。

> 🤖 **AI 代工声明**：本仓库插件与技能代码由 AI（DeepSeek / Claude Code 等）辅助生成、修改与维护，经人工审查与实机验证后发布。使用者请自行测试后再用于重要场景。

面向 DeepSeek Harness（DSH）的 **插件（Plugins）** 与 **Agent 技能（Skills）** 双核心集合，
两者**权重相同**、互相配合、各自独立可装：

- **插件**：扩展 harness 运行时能力（通知、上下文防护、QQ 适配）；
- **技能**：扩展 Agent 行为手册（交接沉淀、主动发 QQ 通知）。

---

## 🧩 插件 Plugins

| 插件 | 作用 | 必备 | 可选增强 |
| --- | --- | --- | --- |
| [`dsh-notify`](packages/dsh-notify) | 通用通知核心：Web UI 内 toast、webhook、文件、日志多通道 | — | — |
| [`dsh-context-guard`](packages/dsh-context-guard) | 上下文防护：跟踪真实输入、达阈值预警、否决注定失败的请求 | dsh-notify（可选，缺失自动降级） | QQ 推送（dsh-qq-notify） |
| [`dsh-qq-notify`](packages/dsh-qq-notify) | QQ 通知/审批双向/会话监控命名（适配层） | dsh-notify | — |
| [`dsh-settings-bridge`](packages/dsh-settings-bridge) | 通用设置桥 + JSON 配置卡片：让上述插件出现在 Web UI 设置页 | — | 建议一起安装 |

设计原则：

1. **零第三方服务依赖**：核心功能只依赖 DSH 本身；QQ 等外部渠道是可选适配，不装也能用。
2. **互相兼容**：通过 `ctx.notify` 服务通信（dsh-notify 提供，其余插件消费）；消费方在服务缺失时降级，不崩溃。
3. **0 运行时第三方包**：插件唯一外部依赖 `@deepseek-ai/schemastery`（DSH 生态自身包），安装时由包管理器自动解析。
4. **开箱即用**：`handoverThreshold` 等均有安全默认值；Web UI 设置 → 插件配置可直接调整。

## 🎯 技能 Skills

| 技能 | 作用 | 依赖 |
| --- | --- | --- |
| [`handover`](skills/handover/SKILL.md) | 配合 dsh-context-guard 的「交代后事」提醒，自动写交接文档、沉淀踩坑经验 | dsh-context-guard（可选） |
| [`qq-notify`](skills/qq-notify/SKILL.md) | 让 Agent 主动给 QQ 发消息（使用前在文件内填入自己的 bridge 地址与 QQ 号） | dsh-qq-notify 插件（可选） |

技能是给 Agent 看的**行为手册**（frontmatter 触发词 + 操作步骤），复制到 `~/.dsh/skills/` 即生效，
不写任何 harness 代码 —— 与插件互补而非替代。

## 插件与技能如何配合

以 QQ 通道为例：

```
插件 dsh-qq-notify  ←→  bridge HTTP /send  ←→  QQ 收到消息
技能 qq-notify      ←→  Agent 按手册调用 /send（"把结果发我 QQ" 时触发）
```

插件负责"通道"，技能负责"行为"：装了插件不装技能，Agent 不会主动想起来发 QQ；
只装技能不装插件，/send 没有实现。两者都装 = 完整闭环。

## 安装

### 插件安装

每个插件目录都是标准 DSH 插件包（`name`/`inject`/`apply` + `cordis.patch.yml`）：

```bash
# 以 dsh-context-guard 为例
git clone <repo> && cd dsh-pluginsANDskills-by-Ty/packages/dsh-context-guard
npm install            # 解析 @deepseek-ai/schemastery
# 将目录 link 到 ~/.dsh/plugins/ 或通过 DSH 插件管理器安装
```

推荐顺序：`dsh-notify` → `dsh-context-guard` →（可选）`dsh-qq-notify` → `dsh-settings-bridge`（放最后或最前均可，它负责给前三个提供设置页）。

升级旧版（v0.1 → v0.2+）：旧版把 `targetQq`/`bridgeUrl`/`decisionsFilePath` 写在 `cordis.patch.yml` 的 `config` 里；新版改为 settings 命名空间（Web UI）管理。直接覆盖会丢配置，请用部署脚本：

```powershell
.\install.ps1            # 自动备份旧版 + 迁移旧 config 到新版 patch + npm install
.\install.ps1 -Only qq-notify   # 或只部署某个插件
```

迁移规则：白名单保留仍有效的键（如 qq-notify 的 `targetQq`/`bridgeUrl`/`decisionsFilePath`），自动剔除新版已删除的键（如 context-guard 的 `targetQq`——它已移入 qq-notify）。

### 技能安装

按需复制到 `~/.dsh/skills/`：

```bash
cp -r skills/handover ~/.dsh/skills/handover
cp -r skills/qq-notify ~/.dsh/skills/qq-notify
```

安装说明见 [skills/README.md](skills/README.md)。

## 文档

- [架构说明](ARCHITECTURE.md)
- [dsh-notify 说明](packages/dsh-notify/README.md)
- [dsh-context-guard 说明](packages/dsh-context-guard/README.md)
- [dsh-qq-notify 说明](packages/dsh-qq-notify/README.md)
- [设置修改指南](docs/SETTINGS.md)
- [插件开发指南](docs/DEVELOPMENT.md)

## 更新日志

### 2026-08-16

- 新增 `dsh-settings-bridge`：通用设置桥 + JSON 配置卡片，让 dsh-notify / dsh-context-guard / dsh-qq-notify 的 settings 命名空间出现在 Web UI 设置页。
- dsh-context-guard / dsh-qq-notify / dsh-notify 增加客户端设置卡片。
- 修复 dsh-qq-notify：`ctx.settings.mutate` 误传对象、会话标签重复 `session-` 前缀、`decisionsFilePath` 轮询动态化、`tokenPrefix` 热更新、`session/disposed` 清理。
- 新增 `skills/handover` 与 `skills/qq-notify`，并清理仓库中的个人数据（QQ 号、本地路径）。
- 文档更新：设置页依赖说明、AI 代工声明、更新日志。

### 2026-08-15 及更早

- 插件/技能双核心结构确立；dsh-notify 通知核心、dsh-context-guard 上下文防护、dsh-qq-notify QQ 适配层完成 v0.2 设计。
- 迁移脚本、安装脚本、mock 测试与迁移测试补齐。

## License

MIT

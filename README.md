# dsh-plugins — DeepSeek Harness 插件库

面向 DeepSeek Harness（DSH）的一组互相兼容的插件，**通用、可独立安装、开箱即用**，不依赖任何特定第三方服务即可工作。

## 插件一览

| 插件 | 作用 | 必备 | 可选增强 |
| --- | --- | --- | --- |
| [`dsh-notify`](packages/dsh-notify) | 通用通知核心：Web UI 内 toast、webhook、文件、日志多通道 | — | — |
| [`dsh-context-guard`](packages/dsh-context-guard) | 上下文防护：跟踪真实输入、达阈值预警、否决注定失败的请求 | dsh-notify（可选，缺失自动降级） | QQ 推送（dsh-qq-notify） |
| [`dsh-qq-notify`](packages/dsh-qq-notify) | QQ 通知/审批双向/会话监控命名（适配层） | dsh-notify | — |

## 设计原则

1. **零第三方服务依赖**：核心功能只依赖 DSH 本身；QQ 等外部渠道是可选适配，不装也能用。
2. **互相兼容**：通过 `ctx.notify` 服务通信（dsh-notify 提供，其余插件消费）；消费方在服务缺失时降级，不崩溃。
3. **0 运行时第三方包**：插件唯一外部依赖 `@deepseek-ai/schemastery`（DSH 生态自身包），安装时由包管理器自动解析。
4. **开箱即用**：`handoverThreshold` 等均有安全默认值；Web UI 设置 → 插件配置可直接调整。

## 安装

每个插件目录都是标准 DSH 插件包（`name`/`inject`/`apply` + `cordis.patch.yml`）：

```bash
# 以 dsh-context-guard 为例
git clone <repo> && cd dsh-plugins/packages/dsh-context-guard
npm install            # 解析 @deepseek-ai/schemastery
# 将目录 link 到 ~/.dsh/plugins/ 或通过 DSH 插件管理器安装
```

推荐顺序：`dsh-notify` → `dsh-context-guard` →（可选）`dsh-qq-notify`。

### 升级旧版（v0.1 → v0.2+）

旧版把 `targetQq`/`bridgeUrl`/`decisionsFilePath` 写在 `cordis.patch.yml` 的 `config` 里；新版改为 settings 命名空间（Web UI）管理。直接覆盖会丢配置，请用部署脚本：

```powershell
# 自动备份旧版 + 迁移旧 config 到新版 patch + npm install
.\install.ps1
# 或只部署某个插件
.\install.ps1 -Only qq-notify
```

迁移规则：白名单保留仍有效的键（如 qq-notify 的 `targetQq`/`bridgeUrl`/`decisionsFilePath`），自动剔除新版已删除的键（如 context-guard 的 `targetQq`——它已移入 qq-notify）。

## 文档

- [架构说明](ARCHITECTURE.md)
- [dsh-notify 说明](packages/dsh-notify/README.md)
- [dsh-context-guard 说明](packages/dsh-context-guard/README.md)
- [dsh-qq-notify 说明](packages/dsh-qq-notify/README.md)
- [设置修改指南](docs/SETTINGS.md)

## License

MIT

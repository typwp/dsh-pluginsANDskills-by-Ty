# dsh-context-guard

DeepSeek Harness 上下文防护插件（通用版，无 QQ 耦合）。

## 解决的问题

UI 上下文分项漏算推理 token，且不预留输出预算；输入 ~75% 时新请求因「输入 + 256K 输出预算」超限直接失败（报错晦涩）。

## 功能

1. **真实输入跟踪**：从 `assistant/message` 的 usage（`cacheReadTokens + inputTokens`）跟踪每会话真实输入（含推理 token）。
2. **阈值预警**：达阈值（默认 70%/85%）经 `ctx.notify` 通知（toast/webhook/QQ 由 dsh-notify 通道决定）。
3. **交代后事触发**：达 `handoverThreshold`（默认 85%）时向 agent 注入提醒 + 通知，配合 handover 技能收尾。
4. **否决注定失败的请求**：`llm/stream` 瀑布 prepend——输入 + 输出预算 > 模型上限时返回清晰错误，省掉注定失败的 API 调用。

## 设置（Web UI → 插件配置 → context-guard）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `modelLimit` | `1048576` | 默认模型输入上限（token） |
| `defaultOutputBudget` | `256000` | 默认输出预算（token） |
| `warnThresholds` | `[0.7, 0.85]` | 预警阈值 |
| `handoverThreshold` | `0.85` | 交代后事触发阈值（0=关闭） |
| `modelLimits` | `{}` | 按模型的输入上限覆盖 |
| `notifyLevel` | `'warn'` | 通知级别（info/warn/error） |
| `notifyChannels` | `[]` | 通知通道覆盖（空=用 dsh-notify 全局配置） |

## 通知链路

```
context-guard ── ctx.notify.send() ──▶ dsh-notify 分发
                                        ├─ toast（Web UI）
                                        ├─ webhook（任意 HTTP 服务）
                                        ├─ file / console
                                        └─ qq（dsh-qq-notify 注册的扩展通道）
```

**不装 dsh-notify**：自动降级为 harness 日志，不崩溃。
**不装 dsh-qq-notify**：QQ 推送不可用，其余照常。

## 依赖

- 运行时仅 `@deepseek-ai/schemastery`。
- 可选 `dsh-notify`（peerDependency，缺失自动降级）。

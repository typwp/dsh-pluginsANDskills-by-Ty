# dsh-notify

DeepSeek Harness 通用通知核心。提供 `ctx.notify` 服务：一条 `send()` 把消息分发到多个通道。

## 通道

| 通道 | 说明 | 配置 |
| --- | --- | --- |
| `toast` | Web UI 右下角浮层提醒（内置 client，零依赖） | 默认开启 |
| `webhook` | HTTP POST JSON 到任意 URL（机器人/服务通用） | `webhookUrl` |
| `file` | 追加到本地日志文件 | `filePath` |
| `console` | 写入 harness 日志 | 默认开启 |
| 扩展通道 | 其他插件可注册（如 dsh-qq-notify 注册 `qq`） | `registerChannel(name, sender)` |

## 使用

```js
// 任意插件（host 端）
const notify = ctx.get('notify')
await notify?.send('任务完成', { level: 'info' })
await notify?.send('警告', { level: 'warn', channels: ['toast', 'qq'] })
```

- `send(message, { level, channels })`：`level ∈ info|warn|error`；`channels` 缺省用全局配置。
- `registerChannel(name, sender)`：注册扩展通道，返回取消函数。
- `channels()`：当前可用通道列表。

## 设置（Web UI → 插件配置 → dsh-notify）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `channels` | `['toast','console']` | 默认启用的通道 |
| `webhookUrl` | `''` | webhook 通道地址（空=禁用） |
| `webhookHeaders` | `{}` | webhook 自定义头 |
| `filePath` | `''` | 文件通道路径（空=禁用） |
| `toastBufferSize` | `50` | toast 缓冲条数 |

## 依赖

- 运行时仅 `@deepseek-ai/schemastery`（DSH 生态包）。
- `dsh-notify` 自己零第三方服务依赖；其他插件可通过 `ctx.get('notify')` 消费，缺失时自行降级。

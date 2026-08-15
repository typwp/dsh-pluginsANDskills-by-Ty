# dsh-qq-notify

DeepSeek Harness QQ 适配层（**可选**插件）。把通用通知接到 QQ（通过 qq-bot bridge），并提供 QQ 特有交互。

> 不装本插件，dsh-context-guard 照常工作（toast/webhook/日志）。
> 装了但未配置 bridge：自动降级，仅日志。

## ⚠️ 前置依赖（必读）：ACP QQ 桥

本插件**不是独立通道**，它通过 [qbot-agent_connection](https://github.com/typwp/qbot-agent_connection)（ACP QQ 桥）转发消息。
要让 QQ 通道真正工作，必须先部署桥并打通两端：

1. **部署桥**：按桥仓库 README 部署 `bridge-acp.mjs`（监听 3457），LLOneBot 上报指向桥 `/message`；
2. **配出站**：本插件设置 `bridgeUrl = http://127.0.0.1:3457/send`（WSL2 下 Windows 侧可直接访问桥的 localhost）；
3. **配入站**：设置 `decisionsFilePath` 指向桥写入的 `harness-decisions.jsonl`（桥仓库默认写 `/mnt/d/qbot-agent_connection/harness-decisions.jsonl`，可按桥侧 `HAR_DECISIONS_FILE` 调整）；
4. `targetQq` 填接收通知的 QQ。

> 端口约定：桥、看门狗、LLOneBot 上报、本插件 `bridgeUrl` **统一 3457**（2026-08-16 定案，勿混用旧 3456）。

## 功能

1. **通知转发**：注册为 dsh-notify 的 `qq` 通道——context-guard 等的预警/拦截消息自动转发 QQ。
2. **审批双向**：`approval/request` 时发 QQ 通知，回复「同意 dsh-xxx」/「拒绝 dsh-xxx」即可决策（与 GUI 并行，先到先得）。
3. **会话监控/命名**：只监控指定会话；通知显示会话别名。
4. **/hn 命令**：经 bridge 决策文件通道查询/修改设置。

## 设置（Web UI → 插件配置 → qq-notify）

修改方法见 [设置修改指南](../docs/SETTINGS.md)（含 QQ `/hn` 命令用法）。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `targetQq` | `''` | 目标 QQ 号（必填才启用 bridge） |
| `bridgeUrl` | `''` | bridge POST 地址，如 `http://127.0.0.1:3457/send` |
| `notifyApproval` | `true` | 权限请求通知 |
| `notifyComplete` | `true` | 任务完成通知 |
| `notifyOnToolOnly` | `true` | 仅工具回合发完成通知 |
| `approvalViaQq` | `true` | QQ 审批开关 |
| `approvalTimeoutMs` | `900000` | 审批超时（ms） |
| `monitoredSessions` | `[]` | 监控会话列表（空=全部） |
| `sessionNames` | `{}` | 会话别名 |
| `decisionsFilePath` | `''` | bridge 决策文件路径（/hn 命令用，空=禁用） |
| `tokenPrefix` | `'dsh-'` | 审批令牌前缀 |
| `relayNotify` | `true` | 转发 dsh-notify 消息到 QQ |

## 依赖

- 运行时仅 `@deepseek-ai/schemastery`。
- 可选 `dsh-notify`（peerDependency）：装了则自动注册 `qq` 通道。
- **外部前置**：ACP QQ 桥（见上「前置依赖」）。

## 桥接协议

- 出站：`POST {bridgeUrl}`，body `{ user_id, message }`。
- 入站（审批/命令）：轮询 `decisionsFilePath`（JSONL，由 bridge 写入），记录形如：
  - `{"type":"approval","token":"dsh-xxx","outcome":"allowed"|"rejected"}`
  - `{"type":"settings","action":"status"|"set"|"monitor-add"|...}`

# dsh-plugins 架构说明

## 目标

一组**通用、可独立安装、互相兼容**的 DSH 插件，面向所有 DeepSeek Harness 用户，不绑定任何特定第三方服务。

## 插件关系

```text
┌───────────────────────┐
│   dsh-context-guard    │  ← 消费方：上下文防护（核心逻辑，零渠道知识）
└──────────┬────────────┘
           │ ctx.notify.send(msg, {level, channels})
           ▼
┌───────────────────────┐       注册扩展通道          ┌───────────────────────┐
│      dsh-notify        │ ◄────────────────────────── │    dsh-qq-notify      │
│  ctx.notify 服务        │  registerChannel('qq', fn)  │  注册 'qq' 通道        │
│  ├ toast（Web UI client）│                            │  + 审批双向            │
│  ├ webhook / file / log │                            │  + 会话监控/命名        │
│  └ registerChannel()    │                            │  + /hn 命令            │
└───────────────────────┘                            └───────────────────────┘
```

- **dsh-notify**：服务提供者（`ctx.notify`）。内置 toast/webhook/file/console 通道；`registerChannel(name, sender)` 让其他插件扩展通道。
- **dsh-context-guard**：服务消费者。只关心「上下文数据 + 阈值」；通知一律走 `ctx.notify`，服务缺失自动降级日志。
- **dsh-qq-notify**：通道提供者 + QQ 特有交互。把 QQ bridge 注册为 `qq` 通道；审批/监控/命名是 QQ 渠道独占能力，与通知核心解耦。

## 服务契约（ctx.notify）

```js
notify.send(message, opts)            // opts: { level: 'info'|'warn'|'error', channels?: string[] }
notify.registerChannel(name, sender)  // sender: async (message, level) => boolean
notify.channels()                     // 当前可用通道列表
notify.status()                       // 配置摘要
```

消费方推荐写法（缺失降级）：

```js
const notify = ctx.get?.('notify')
if (notify?.send) await notify.send(msg, { level: 'warn' })
else ctx.logger.warn(`[my-plugin] ${msg}`)
```

## 通道提供方写法（如 QQ 适配）

```js
// 顺序无关：dsh-notify 可能先或后加载
function attach() {
  const notify = ctx.get?.('notify')
  if (!notify?.registerChannel || attached) return
  attached = true
  unregister = notify.registerChannel('qq', async (msg, level) => { /* 发 QQ */ })
}
attach()
ctx.on('internal/service', (name) => { if (name === 'notify') attach() })
// dispose: unregister(); offListener()
```

## 事件/路由

| 能力 | 机制 | 备注 |
| --- | --- | --- |
| Web UI toast | host 注册 `/api/dsh-notify/poll`（webServer 可选，`internal/service` 等待） | client.js 每 2s 轮询增量拉取 |
| 服务发现 | `ctx.provide` + `ctx.get` + `internal/service` 事件 | 顺序无关 |
| 设置 | `ctx.settings.register(ns, schema, {base})` | Web UI 插件配置页自动渲染 |

## 兼容性与降级矩阵

| 安装组合 | 行为 |
| --- | --- |
| 只装 dsh-context-guard | 防护生效；通知写 harness 日志 |
| dsh-context-guard + dsh-notify | 防护 + toast（Web UI）+ 可配 webhook/file |
| 全装（+ dsh-qq-notify） | 全能力：toast + QQ 推送/审批/监控 |
| dsh-qq-notify 未配 bridge | QQ 通道注册但 send 返回 false，其余照常 |

## 依赖策略

- 每个插件唯一运行时依赖：`@deepseek-ai/schemastery`（DSH 生态包，安装时由包管理器自动解析）。
- 插件间通过 `peerDependencies` + `peerDependenciesMeta.optional` 声明可选关系，不强制。
- 无任何第三方服务依赖；QQ 只是可选适配。

## 测试

`node mock-test.mjs`：模拟 cordis ctx（settings/on/provide/logger/agents），验证 apply 不抛错、服务注册、通道注册/取消、加载顺序无关、路由注册、降级路径。无第三方依赖。

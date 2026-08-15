# dsh-plugins 插件开发指南

面向想扩展 dsh-plugins 或写自己插件的开发者。读完本文你可以：写一个能接入 `ctx.notify` 通知体系的新插件、加一个新通知通道、跑通测试与部署。

## 0. 插件最小结构

一个 DSH 插件就是一个标准 npm 包 + cordis 插件入口：

```
my-plugin/
├── package.json          # name/inject/apply 契约
├── lib/index.js          # 宿主（host）插件主体
├── cordis.patch.yml      # 挂载声明（让 harness 加载它）
├── README.md
└── LICENSE
```

`lib/index.js` 的最小骨架：

```js
import z from '@deepseek-ai/schemastery'

export const name = 'my-plugin'
export const inject = ['settings']   // 需要的服务

export function apply(ctx, config = {}) {
  // 1. 设置注册（Web UI 会自动渲染表单）
  const owner = ctx.settings.register('my-plugin', z.object({
    enabled: z.boolean(),
    message: z.string().default('hi'),
  }), { base: { enabled: true, message: 'hi' } })
  let cfg = { enabled: true, message: 'hi', ...owner.get() }
  owner.watch((next) => { cfg = { ...cfg, ...next } })  // Web UI 改值热更新

  // 2. 业务逻辑：监听 harness 事件
  ctx.on('some/event', (data) => {
    // ...
  })

  // 3. 可选：返回清理函数
  return () => { /* 清理 timer/listener */ }
}
```

## 1. 接入通知体系（消费 ctx.notify）

推荐写法——**服务缺失自动降级，不崩溃**：

```js
async function notify(ctx, message, level = 'info') {
  const svc = ctx.get?.('notify')
  if (svc?.send) {
    await svc.send(message, { level })
    return
  }
  // 降级：写 harness 日志
  ctx.logger[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'](`[my-plugin] ${message}`)
}
```

- `level ∈ info | warn | error`
- 可选 `channels` 覆盖全局（如 `{ channels: ['toast', 'qq'] }`）
- 消费方**不需要**声明 dsh-notify 为硬依赖；把它放 `peerDependenciesMeta.optional` 即可

## 2. 提供新通知通道（扩展 registerChannel）

任何插件都能给 dsh-notify 加通道。以「Slack 适配」为例：

```js
function attach() {
  const notify = ctx.get?.('notify')
  if (!notify?.registerChannel || attached) return
  attached = true
  unregister = notify.registerChannel('slack', async (message, level) => {
    // 把 message 发到 Slack webhook
    try {
      await fetch('https://hooks.slack.com/services/...', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: message }),
      })
      return true
    } catch { return false }
  })
}
attach()
// 顺序无关：dsh-notify 可能后加载
ctx.on('internal/service', (name) => { if (name === 'notify') attach() })

// dispose 时：unregister(); offListener()
```

注册后，任何插件 `notify.send(msg, { channels: ['slack'] })` 都会走你的通道；若你的通道在全局 `channels` 配置里，则自动成为默认通道之一。

## 3. 注册 Web UI 设置页

- 用 `ctx.settings.register(ns, schema, { base })`；
- `schema` 用 schemastery：`z.boolean()` / `z.number()` / `z.string()` / `z.array(...)` / `z.dict(...)`；
- Web UI 按 schema 类型自动渲染对应控件（开关/数字/文本/数组/键值对），改完立即生效；
- 命名空间唯一（kebab-case），别与其他插件冲突。

用户的操作入口见 [设置修改指南](SETTINGS.md)。

## 4. 声明依赖（保持 0 第三方）

- 唯一运行时依赖：`@deepseek-ai/schemastery`（DSH 生态包）；
- 插件间关系用 `peerDependencies` + `peerDependenciesMeta.optional` 声明可选；
- 不要用 `createRequire` 去 harness 依赖树里"现找"包——已验证脆弱（USERPROFILE 环境问题），直接声明依赖让包管理器解析。

## 5. 挂载声明（cordis.patch.yml）

```yaml
---
# my-plugin bundle patch: mount the plugin.
- insert:
    - id: my-plugin        # 唯一 id
      name: my-plugin      # 包名
```

## 6. 测试

仓库内测试不依赖第三方（纯 Node）：

```bash
node mock-test.mjs              # 插件 apply/服务/通道/降级 全链路
node test/migrate-config.test.mjs  # 配置迁移边界
node test/package-audit.mjs     # 发布完整性
```

新插件可仿照 `mock-test.mjs` 里的 `makeCtx()` 模拟 cordis ctx（on/provide/get/settings/logger），验证自己的 apply 不抛错、服务注册正确、降级路径可用。

## 7. 发布与部署

- 每个包 `files` 字段要包含 `lib`、`cordis.patch.yml`、`README.md`、`LICENSE`；
- `npm install` 后把目录 link 到 `~/.dsh/plugins/`（或走 DSH 插件管理器）；
- 升级时用仓库的 `install.ps1`（自动备份 + 迁移旧 config）；
- 发布前跑 `node test/package-audit.mjs` 确认 files/exports 完整。

## 8. 设计约定（保持整体性）

1. **降级优先**：消费可选服务前先 `ctx.get?.()` 判断，缺失走日志，不崩；
2. **顺序无关**：等待 `internal/service` 事件而非假设加载顺序；
3. **命名空间唯一**：settings 命名空间与插件名一致（或明显归属）；
4. **通知走 ctx.notify**：不要自己硬编码某个渠道（如直接 fetch QQ bridge）——那是适配层的事；
5. **QQ 等外部服务只进适配层**：核心插件保持零第三方服务依赖。

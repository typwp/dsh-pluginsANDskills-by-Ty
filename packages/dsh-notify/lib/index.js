/**
 * dsh-notify — 通用通知核心。
 *
 * 提供 `ctx.notify` 服务：一条 send() 把消息分发到多个通道：
 *   - toast    Web UI 内浮层提醒（client 端轮询 /api/dsh-notify/poll）
 *   - webhook  HTTP POST（通用，任何机器人/服务可接）
 *   - file     追加到本地日志文件
 *   - console  写入 harness 日志
 *
 * 设计：零第三方服务依赖；其他插件（context-guard / qq-notify）通过
 * `ctx.notify` 消费；服务缺失时消费方自行降级，不崩溃。
 */
import z from '@deepseek-ai/schemastery'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const name = 'dsh-notify'
export const inject = ['settings']

export function apply(ctx, config = {}) {
  const base = {
    enabled: config.enabled ?? true,
    channels: config.channels ?? ['toast', 'console'],
    webhookUrl: config.webhookUrl ?? '',
    webhookHeaders: config.webhookHeaders ?? {},
    filePath: config.filePath ?? '',
    toastBufferSize: config.toastBufferSize ?? 50,
  }
  const schema = z.object({
    enabled: z.boolean(),
    channels: z.array(z.string()).default(['toast', 'console']),
    webhookUrl: z.string().default(''),
    webhookHeaders: z.dict(z.string()).default({}),
    filePath: z.string().default(''),
    toastBufferSize: z.number().default(50),
  })
  const owner = ctx.settings.register('dsh-notify', schema, { base })
  let cfg = { ...base, ...owner.get() }
  owner.watch((next) => { cfg = { ...base, ...next } })

  // toast 缓冲：client 端通过 /api/dsh-notify/poll 增量拉取
  let toastSeq = 0
  const toastBuffer = []

  // 扩展通道注册表：其他插件（如 dsh-qq-notify）可注册自定义通道，
  // 例如 registerChannel('qq', async (message, level) => {...})
  const extraChannels = new Map()

  function pushToast(message, level = 'info') {
    const seq = ++toastSeq
    toastBuffer.push({ seq, ts: Date.now(), level, message })
    if (toastBuffer.length > cfg.toastBufferSize) toastBuffer.shift()
    return seq
  }

  async function sendToWebhook(message, level) {
    if (!cfg.webhookUrl) return
    try {
      const res = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...cfg.webhookHeaders },
        body: JSON.stringify({ level, message, ts: Date.now() }),
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) ctx.logger.warn(`[dsh-notify] webhook 响应异常: ${res.status}`)
    } catch (e) {
      ctx.logger.warn(`[dsh-notify] webhook 发送失败: ${e.message}`)
    }
  }

  function sendToFile(message) {
    if (!cfg.filePath) return
    try {
      mkdirSync(dirname(cfg.filePath), { recursive: true })
      appendFileSync(cfg.filePath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
    } catch (e) {
      ctx.logger.warn(`[dsh-notify] 文件通道失败: ${e.message}`)
    }
  }

  function sendToConsole(message, level) {
    if (level === 'error') ctx.logger.error(`[dsh-notify] ${message}`)
    else if (level === 'warn') ctx.logger.warn(`[dsh-notify] ${message}`)
    else ctx.logger.info(`[dsh-notify] ${message}`)
  }

  /** 核心 send：level ∈ info|warn|error；channels 覆盖全局配置。 */
  async function send(message, opts = {}) {
    if (!cfg.enabled) return { ok: false, reason: 'disabled' }
    const level = opts.level ?? 'info'
    const channels = opts.channels?.length ? opts.channels : cfg.channels
    const results = { toast: 0, webhook: false, file: false, console: false }
    for (const ch of channels) {
      switch (ch) {
        case 'toast': results.toast = pushToast(message, level); break
        case 'webhook': await sendToWebhook(message, level); results.webhook = true; break
        case 'file': sendToFile(message); results.file = true; break
        case 'console': sendToConsole(message, level); results.console = true; break
        default: {
          const sender = extraChannels.get(ch)
          if (sender) {
            try {
              await sender(message, level)
              results[ch] = true
            } catch (e) {
              ctx.logger.warn(`[dsh-notify] 通道 ${ch} 失败: ${e.message}`)
            }
          } else {
            ctx.logger.warn(`[dsh-notify] 未知通道: ${ch}`)
          }
        }
      }
    }
    return { ok: true, results }
  }

  // ── /api/dsh-notify/poll 路由（webServer 可选；memento 同款 withService 模式）──
  function registerPollRoute(webServer) {
    if (typeof webServer?.register !== 'function') return
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-notify/poll',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost')
          const after = Number(url.searchParams.get('after') ?? 0)
          const items = toastBuffer.filter((t) => t.seq > after)
          res.statusCode = 200
          res.setHeader?.('content-type', 'application/json')
          res.end(JSON.stringify({ items, latest: toastSeq }))
        } catch {
          res.statusCode = 500
          res.end('{}')
        }
      },
    })
  }
  const offService = ctx.on('internal/service', (name) => {
    if (name !== 'webServer') return
    registerPollRoute(ctx.get('webServer'))
  })
  registerPollRoute(ctx.get('webServer'))

  // 挂载 ctx.notify 服务：构造即注册，fiber 卸载自动移除
  const service = {
    send,
    /** 注册扩展通道（如 'qq'），返回取消注册函数。 */
    registerChannel(name, sender) {
      if (extraChannels.has(name)) {
        ctx.logger.warn(`[dsh-notify] 通道 ${name} 已存在，覆盖`)
      }
      extraChannels.set(name, sender)
      return () => extraChannels.delete(name)
    },
    /** 已注册通道列表（内置 + 扩展）。 */
    channels() {
      return [...new Set([...cfg.channels, ...extraChannels.keys()])]
    },
    status() {
      return { enabled: cfg.enabled, channels: this.channels(), webhookUrl: cfg.webhookUrl || null, filePath: cfg.filePath || null }
    },
  }
  const unprovide = ctx.provide('notify', service)

  return () => {
    offService()
    unprovide()
    toastBuffer.length = 0
    toastSeq = 0
  }
}

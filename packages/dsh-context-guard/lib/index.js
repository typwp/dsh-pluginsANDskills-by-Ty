/**
 * dsh-context-guard — 上下文防护（通用版）。
 *
 * 问题：UI 上下文分项漏算推理 token，且不预留输出预算；输入 ~75% 时新请求
 * 因「输入 + 256K 输出预算」超限直接失败（且报错晦涩）。
 *
 * 方案：
 *  1. 从 assistant/message 的 usage（cacheReadTokens + inputTokens）跟踪每会话真实输入；
 *  2. 达阈值（默认 70%/85%）经 ctx.notify 预警（toast/webhook/QQ 等由 dsh-notify 通道决定）；
 *  3. 达 handoverThreshold 时注入「交代后事」提醒 + 通知；
 *  4. llm/stream 瀑布 prepend：输入 + 输出预算 > 模型上限时**否决**请求，
 *     返回清晰错误（省掉注定失败的 API 调用）。
 *
 * 依赖：dsh-notify 可选（提供 ctx.notify 服务）；缺失时自动降级为 logger，
 * 不崩溃。QQ 推送通过 dsh-qq-notify（订阅 notify 转发）或 dsh-notify 的
 * webhook 通道实现，本插件不直接依赖任何具体渠道。
 */
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-context-guard'
export const inject = ['settings', 'agents']

export function apply(ctx, config = {}) {
  const base = {
    enabled: config.enabled ?? true,
    modelLimit: config.modelLimit ?? 1048576,
    defaultOutputBudget: config.defaultOutputBudget ?? 256000,
    warnThresholds: config.warnThresholds ?? [0.7, 0.85],
    handoverThreshold: config.handoverThreshold ?? 0.85,
    modelLimits: config.modelLimits ?? {},
    notifyLevel: config.notifyLevel ?? 'warn',
    notifyChannels: config.notifyChannels ?? [], // 空 = 用 dsh-notify 全局配置
  }
  const schema = z.object({
    enabled: z.boolean(),
    modelLimit: z.number(),
    defaultOutputBudget: z.number(),
    warnThresholds: z.array(z.number()),
    handoverThreshold: z.number(),
    modelLimits: z.dict(z.number()),
    notifyLevel: z.string(),
    notifyChannels: z.array(z.string()).default([]),
  })
  const owner = ctx.settings.register('context-guard', schema, { base })
  let cfg = { ...base, ...owner.get() }
  owner.watch((next) => { cfg = { ...base, ...next } })

  const perSessionInput = new Map()
  const warned = new Set()
  const handoverNotified = new Set()

  /** 通知：优先 ctx.notify（dsh-notify 提供）；缺失降级 logger。永不抛出。 */
  async function notify(message, level = cfg.notifyLevel) {
    const opts = { level }
    if (cfg.notifyChannels?.length) opts.channels = cfg.notifyChannels
    try {
      const notifyService = ctx.get?.('notify')
      if (notifyService?.send) {
        await notifyService.send(message, opts)
        return
      }
    } catch (e) {
      ctx.logger.warn(`[context-guard] notify 服务调用失败，降级日志: ${e.message}`)
    }
    // 降级：写入 harness 日志
    if (level === 'error') ctx.logger.error(`[context-guard] ${message}`)
    else if (level === 'warn') ctx.logger.warn(`[context-guard] ${message}`)
    else ctx.logger.info(`[context-guard] ${message}`)
  }

  function limitFor(model) { return cfg.modelLimits?.[model] ?? cfg.modelLimit }

  // 跟踪每会话真实输入（cacheRead + input，含推理）
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'assistant/message') return
    const u = event.data?.usage
    if (!u) return
    const input = (u.cacheReadTokens ?? 0) + (u.inputTokens ?? 0)
    const sid = session?.id ?? '?'
    perSessionInput.set(sid, input)
    if (perSessionInput.size > 30) {
      for (const k of [...perSessionInput.keys()].slice(0, perSessionInput.size - 30)) perSessionInput.delete(k)
    }
    const limit = cfg.modelLimit
    const room = limit - cfg.defaultOutputBudget
    const pct = room > 0 ? input / room : 0
    for (const th of [...cfg.warnThresholds].sort((a, b) => a - b)) {
      const key = sid + '@' + th
      if (pct >= th && !warned.has(key)) {
        warned.add(key)
        if (warned.size > 100) warned.clear()
        notify(`⚠️ 会话 ${sid.slice(0, 8)} 上下文已达 ${Math.round(pct * 100)}%（真实输入含推理 ${input} / 上限 ${limit}）。建议开新会话交接，避免触发超限。`)
      }
    }
    // 「交代后事」触发：达 handoverThreshold 时注入提醒 + 通知，让 agent 按 handover 技能收尾
    if (cfg.handoverThreshold > 0 && pct >= cfg.handoverThreshold && !handoverNotified.has(sid)) {
      handoverNotified.add(sid)
      const msg = `⚠️ 上下文危险：真实输入含推理已达 ${Math.round(pct * 100)}%（${input} / 上限 ${limit}）。建议执行「交代后事」：写未完待办与已完成事项、踩坑经验写入跨会话记忆，为下一个对话窗口交接。`
      notify(`📦 ${msg}`)
      try {
        const agent = ctx.agents.get(sid)
        if (agent) {
          agent.inject({
            role: 'user',
            content: [{ type: 'text', text: msg }],
            source: { kind: 'plugin', plugin: 'context-guard' },
          })
          ctx.logger.info(`[context-guard] 已向会话 ${sid.slice(0, 8)} 注入交代后事提醒`)
        }
      } catch (err) {
        ctx.logger.warn(`[context-guard] 注入失败: ${err.message}`)
      }
    }
  })

  // 否决注定失败的请求（read-only：不改 frozen options）
  ctx.on('llm/stream', (options, next) => {
    if (!cfg.enabled) return next()
    const sid = options?.sessionId ?? '?'
    const input = perSessionInput.get(sid) ?? 0
    const limit = limitFor(options?.model)
    const budget = options?.maxTokens ?? cfg.defaultOutputBudget
    const total = input + budget
    if (total > limit) {
      ctx.logger.warn(`[context-guard] 否决 ${sid.slice(0, 8)}: 输入 ${input} + 输出 ${budget} > ${limit}`)
      notify(`🚫 已拦截注定失败的请求：输入 ${input} + 输出预算 ${budget} > 模型上限 ${limit}。请开新会话交接。`, 'error')
      return (async function* () {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: {
              message: `上下文已满：输入约 ${input} tokens + 输出预算 ${budget} 超过模型上限 ${limit}。请开新会话并交接当前任务。`,
              code: 'CONTEXT_GUARD',
            },
          },
        }
      })()
    }
    return next()
  }, { prepend: true })
}

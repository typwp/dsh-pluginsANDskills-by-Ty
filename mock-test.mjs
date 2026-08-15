/**
 * mock 验证：模拟 cordis ctx，加载 dsh-plugins 三个插件，验证：
 *  1. 每个插件 apply() 不抛错；
 *  2. dsh-notify 提供 ctx.notify 服务（send/registerChannel/channels/status）；
 *  3. context-guard 通知链路（notify 服务存在时走服务，缺失时降级日志）；
 *  4. qq-notify 注册 'qq' 通道，send 到 bridge；
 *  5. 卸载函数可调用、不抛错。
 *
 * 运行：node mock-test.mjs
 * 不依赖任何第三方包（schemastery 需要插件目录里有，或从 node_modules 解析）。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

let failures = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`)
  else { failures++; console.log(`  ❌ ${name} ${extra}`) }
}

// ── 最小 cordis ctx mock ──
function makeCtx() {
  const listeners = new Map()
  const services = new Map()
  const settingsOwners = new Map()
  const ctx = {
    logger: {
      info: (...a) => console.log('    [log:info]', ...a),
      warn: (...a) => console.log('    [log:warn]', ...a),
      error: (...a) => console.log('    [log:error]', ...a),
    },
    on: (event, cb) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(cb)
      return () => {
        const arr = listeners.get(event)
        if (arr) { const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1) }
      }
    },
    emit: (event, ...args) => {
      for (const cb of listeners.get(event) ?? []) cb(...args)
    },
    get: (name) => services.get(name),
    provide: (name, value) => {
      services.set(name, value)
      ctx.emit('internal/service', name)
      return () => services.delete(name)
    },
    set: (name, value) => { services.set(name, value) },
    settings: {
      register: (ns, _schema, options) => {
        const owner = {
          get: () => ({ ...(options?.base ?? {}) }),
          watch: () => () => {},
          update: async () => {},
          replace: async () => {},
        }
        settingsOwners.set(ns, owner)
        return owner
      },
      mutate: async () => {},
      get: (ns) => settingsOwners.get(ns)?.get(),
    },
    agents: {
      get: () => null,
    },
  }
  return ctx
}

// ── 加载插件 ──
async function loadPlugin(name) {
  const url = new URL(`packages/${name}/lib/index.js`, import.meta.url)
  const mod = await import(url.href)
  return mod
}

console.log('== 1. dsh-notify ==')
{
  const ctx = makeCtx()
  const plugin = await loadPlugin('dsh-notify')
  check('exports name', plugin.name === 'dsh-notify', plugin.name)
  check('exports inject', Array.isArray(plugin.inject))
  const dispose = plugin.apply(ctx, {})
  check('apply() 不抛错', true)
  const notify = ctx.get('notify')
  check('ctx.notify 已提供', !!notify?.send)
  const res = await notify.send('hello toast', { level: 'info' })
  check('send() 返回 ok', res?.ok === true)
  const chans = notify.channels()
  check('默认通道含 toast/console', chans.includes('toast') && chans.includes('console'), chans.join(','))
  // 注册扩展通道
  let qqGot = null
  const unreg = notify.registerChannel('qq', async (msg, level) => { qqGot = { msg, level }; return true })
  check('registerChannel 返回函数', typeof unreg === 'function')
  await notify.send('to qq', { channels: ['qq'] })
  check('扩展通道收到消息', qqGot?.msg === 'to qq', JSON.stringify(qqGot))
  unreg()
  const chans2 = notify.channels()
  check('取消注册后通道移除', !chans2.includes('qq'), chans2.join(','))
  dispose()
  check('dispose 不抛错', true)
}

console.log('== 2. dsh-context-guard（有 notify 服务）==')
{
  const ctx = makeCtx()
  const notifyPlugin = await loadPlugin('dsh-notify')
  notifyPlugin.apply(ctx, {})
  const sentMessages = []
  ctx.get('notify').send = async (msg, opts) => { sentMessages.push({ msg, opts }); return { ok: true } }
  const plugin = await loadPlugin('dsh-context-guard')
  const dispose = plugin.apply(ctx, {})
  check('apply() 不抛错', true)
  // 模拟 session/event：输入 900K，上限 1M，输出预算 256K → 阈值 0.7 触发
  const sid = 'session-test123'
  ctx.emit('session/event', { id: sid }, { type: 'assistant/message', data: { usage: { cacheReadTokens: 500000, inputTokens: 400000 } } })
  await new Promise((r) => setTimeout(r, 50))
  check('阈值预警已发送到 notify', sentMessages.length >= 1, JSON.stringify(sentMessages))
  check('预警消息含会话短 id', sentMessages.some((m) => m.msg.includes('session-')), JSON.stringify(sentMessages))
  if (typeof dispose === 'function') dispose()
  check('dispose 不抛错', true)
}

console.log('== 3. dsh-context-guard（无 notify 服务 → 降级）==')
{
  const ctx = makeCtx()
  const plugin = await loadPlugin('dsh-context-guard')
  let dispose = null
  try {
    dispose = plugin.apply(ctx, {})
    check('apply() 无 notify 不抛错', true)
  } catch (e) {
    check('apply() 无 notify 不抛错', false, e.message)
  }
  // 触发事件不应抛错
  try {
    ctx.emit('session/event', { id: 'sid2' }, { type: 'assistant/message', data: { usage: { cacheReadTokens: 600000, inputTokens: 300000 } } })
    check('无 notify 时事件处理不抛错', true)
  } catch (e) {
    check('无 notify 时事件处理不抛错', false, e.message)
  }
  if (dispose) dispose()
}

console.log('== 4. dsh-qq-notify（注册 qq 通道 + 审批降级）==')
{
  const ctx = makeCtx()
  const notifyPlugin = await loadPlugin('dsh-notify')
  notifyPlugin.apply(ctx, {})
  const plugin = await loadPlugin('dsh-qq-notify')
  const dispose = plugin.apply(ctx, { targetQq: '10001', bridgeUrl: 'http://localhost:3456/send' })
  check('apply() 不抛错', true)
  const notify = ctx.get('notify')
  check('qq 通道已注册', notify.channels().includes('qq'), notify.channels().join(','))
  // send 到 qq 通道：无真实 bridge，send 内部 try/catch 返回 false，不抛错
  const res = await notify.send('test relay', { channels: ['qq'] })
  check('qq 通道 send 不抛错', res?.ok === true)
  dispose()
  check('dispose 不抛错', true)
}

console.log('== 5. dsh-qq-notify（未配置 bridge → 降级不崩）==')
{
  const ctx = makeCtx()
  const plugin = await loadPlugin('dsh-qq-notify')
  let dispose = null
  try {
    dispose = plugin.apply(ctx, {})
    check('apply() 未配置不抛错', true)
  } catch (e) {
    check('apply() 未配置不抛错', false, e.message)
  }
  if (dispose) dispose()
}

console.log('')
if (failures) {
  console.log(`❌ ${failures} 项失败`)
  process.exit(1)
} else {
  console.log('✅ 全部通过')
}

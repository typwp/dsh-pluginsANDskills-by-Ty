/**
 * 配置迁移：把旧版插件 cordis.patch.yml 的 config 合并到新版 patch。
 *
 * 背景：旧版（v0.1）把 targetQq/bridgeUrl/decisionsFilePath 等写在
 * cordis.patch.yml 的 config 里；新版（v0.2+）改为 settings 命名空间管理
 * （Web UI），patch 不再带 config。直接覆盖部署会丢用户配置。
 *
 * 本脚本把旧 patch 中 insert 项的 config 合并进新 patch 的对应项，
 * 作为启动默认值（settings 层仍可覆盖）。已知键白名单过滤，
 * 避免把新版已删除的键（如 context-guard 的 targetQq）写进去。
 *
 * 用法：node scripts/migrate-config.mjs <old-patch.yml> <new-patch.yml> <plugin-name>
 * 输出：迁移后的新 patch 内容写回 new-patch.yml（原文件备份 .migrate.bak）。
 *
 * 纯 Node，无第三方依赖（patch YAML 结构规整，用行级解析）。
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'

const [, , oldPath, newPath, pluginName] = process.argv
if (!oldPath || !newPath || !pluginName) {
  console.error('用法: node scripts/migrate-config.mjs <old-patch.yml> <new-patch.yml> <plugin-name>')
  process.exit(1)
}

/** 各插件允许迁移的配置键（新版 schema 仍在的）。 */
const ALLOWED_KEYS = {
  'dsh-context-guard': new Set(['enabled', 'modelLimit', 'defaultOutputBudget', 'warnThresholds', 'handoverThreshold', 'modelLimits', 'notifyLevel', 'notifyChannels']),
  'dsh-qq-notify': new Set(['targetQq', 'bridgeUrl', 'notifyApproval', 'notifyComplete', 'notifyOnToolOnly', 'approvalViaQq', 'approvalTimeoutMs', 'monitoredSessions', 'sessionNames', 'decisionsFilePath', 'tokenPrefix', 'relayNotify']),
  'dsh-notify': new Set(['enabled', 'channels', 'webhookUrl', 'webhookHeaders', 'filePath', 'toastBufferSize']),
}

function parsePatchConfig(text, targetName) {
  // 找到 `name: <targetName>` 所在 insert 项，提取其 config 块（缩进 map）
  const lines = text.split('\n')
  const nameRe = new RegExp(`^\\s*name:\\s*['"]?${targetName}['"]?\\s*$`)
  let nameIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (nameRe.test(lines[i])) { nameIdx = i; break }
  }
  if (nameIdx < 0) return null

  // 从 name 行往下找第一个 config: 行
  let cfgIdx = -1
  for (let i = nameIdx + 1; i < lines.length; i++) {
    const m = /^(\s*)config:/.exec(lines[i])
    if (m) { cfgIdx = i; break }
    // 遇到缩进 <= name 行缩进的非空行 → 已离开该项
    const nm = /^(\s*)\S/.exec(lines[i])
    if (nm && !lines[i].trim().startsWith('#')) {
      const nameIndent = (nameRe.exec(lines[nameIdx]) ? /^\s*/.exec(lines[nameIdx])[0].length : 2)
      if (nm[1].length <= nameIndent) break
    }
  }
  if (cfgIdx < 0) return null

  const cfgIndent = /^(\s*)config:/.exec(lines[cfgIdx])[1].length
  const cfg = {}
  for (let i = cfgIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const m = /^(\s*)([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (!m) break
    if (m[1].length <= cfgIndent) break // 缩进回退 → config 结束
    const key = m[2]
    let val = m[3].trim()
    // 去掉 YAML 单引号；数组/对象保持原样字符串（简单场景够用）
    if (/^'.*'$/.test(val)) val = val.slice(1, -1)
    cfg[key] = val
  }
  return Object.keys(cfg).length ? cfg : null
}

function injectConfig(text, targetName, cfg) {
  const lines = text.split('\n')
  const nameRe = new RegExp(`^\\s*name:\\s*['"]?${targetName}['"]?\\s*$`)
  let nameIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (nameRe.test(lines[i])) { nameIdx = i; break }
  }
  if (nameIdx < 0) return text
  const nameIndent = /^\s*/.exec(lines[nameIdx])[0].length
  const cfgIndent = ' '.repeat(nameIndent) // config: 与 name: 同级
  const kvIndent = ' '.repeat(nameIndent + 2)
  const block = [`${cfgIndent}config:`]
  for (const [k, v] of Object.entries(cfg)) {
    block.push(`${kvIndent}${k}: ${yamlScalar(v)}`)
  }
  lines.splice(nameIdx + 1, 0, ...block)
  return lines.join('\n')
}

/** 把字符串值转成 YAML 标量（布尔/数字/数组不引号，其余加单引号）。 */
function yamlScalar(val) {
  const s = String(val).trim()
  if (/^(true|false)$/i.test(s)) return s.toLowerCase()
  if (/^-?\d+(\.\d+)?$/.test(s)) return s
  if (/^\[.*\]$/.test(s) || /^\{.*\}$/.test(s)) return s // 数组/对象保持原样
  return `'${s.replace(/'/g, "''")}'`
}

// ── 执行 ──
if (!existsSync(oldPath)) { console.log(`[migrate] 无旧 patch（${oldPath}），跳过`); process.exit(0) }
const oldText = readFileSync(oldPath, 'utf8')
let newText = readFileSync(newPath, 'utf8')
const cfg = parsePatchConfig(oldText, pluginName)
if (!cfg) { console.log(`[migrate] 旧 patch 无 config（${pluginName}），无需迁移`); process.exit(0) }

const allowed = ALLOWED_KEYS[pluginName] ?? new Set()
const filtered = {}
for (const [k, v] of Object.entries(cfg)) {
  if (allowed.has(k)) filtered[k] = v
  else console.log(`[migrate] 丢弃已移除的键: ${k}（${pluginName} 新版不再使用）`)
}
if (!Object.keys(filtered).length) { console.log('[migrate] 无可迁移键，跳过'); process.exit(0) }

const bak = newPath + '.migrate.bak'
renameSync(newPath, bak)
newText = injectConfig(newText, pluginName, filtered)
writeFileSync(newPath, newText, 'utf8')
console.log(`[migrate] ✅ 已迁移 ${Object.keys(filtered).length} 个配置键到 ${newPath}`)
console.log(`[migrate]    原文件备份: ${bak}`)

/**
 * 发布前审计：验证每个包的 files 字段声明与实际文件匹配。
 * 运行：node test/package-audit.mjs
 * 无第三方依赖。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let failures = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`)
  else { failures++; console.log(`  ❌ ${name} ${extra}`) }
}

console.log('== 发布包完整性审计 ==')

for (const pkg of ['dsh-notify', 'dsh-context-guard', 'dsh-qq-notify']) {
  const dir = join(root, 'packages', pkg)
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) { console.log(`  ⚠ 跳过 ${pkg}（无 package.json）`); continue }
  const p = JSON.parse(readFileSync(pkgPath, 'utf8'))
  console.log(`\n-- ${pkg} v${p.version} --`)

  // 1. files 字段声明都存在
  for (const f of p.files ?? []) {
    const target = join(dir, f)
    check(`files 声明存在: ${f}`, existsSync(target), target)
  }

  // 2. main / exports["."] 指向存在
  if (p.main) check(`main 存在: ${p.main}`, existsSync(join(dir, p.main)))
  const dot = p.exports?.['.']
  if (typeof dot === 'string') check(`exports["."] 存在: ${dot}`, existsSync(join(dir, dot)))

  // 3. client 声明一致性
  const client = p.dsh?.client
  if (client) {
    check('client.platform = web', client.platform === 'web', JSON.stringify(client))
    if (p.exports?.['./client']) {
      const c = p.exports['./client']
      const cPath = typeof c === 'string' ? c : c.default
      check(`exports["./client"] 存在: ${cPath}`, existsSync(join(dir, cPath)))
    }
  }

  // 4. 必填字段
  check('有 name', typeof p.name === 'string' && p.name.length > 0)
  check('有 version', typeof p.version === 'string' && /^\d+\.\d+\.\d+/.test(p.version))
  check('有 license', typeof p.license === 'string')
  check('有 type=module', p.type === 'module')
  check('有 dependencies (schemastery)', !!p.dependencies?.['@deepseek-ai/schemastery'])
}

console.log('')
if (failures) {
  console.log(`❌ ${failures} 项失败`)
  process.exit(1)
}
console.log('✅ 发布包审计全部通过')

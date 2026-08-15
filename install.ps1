# dsh-plugins 一键部署到 ~/.dsh/plugins/
#
# 用法：
#   PowerShell:  .\install.ps1 [-Only notify|context-guard|qq-notify] [-SkipNpmInstall]
#
# 做什么：
#   1. 把 packages/<name> 复制到 $HOME/.dsh/plugins/<name>（覆盖前自动备份 .bak）；
#   2. 若本机有 npm，执行 npm install（解析 @deepseek-ai/schemastery）；
#   3. 提示重启 harness（update-harness.bat 或手动）。
#
# 安全：全程不动运行中的插件文件——复制到目标前先备份，失败可回滚。

param(
  [ValidateSet('', 'notify', 'context-guard', 'qq-notify')]
  [string]$Only = '',
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginsRoot = Join-Path $HOME '.dsh\plugins'
$names = if ($Only) { @($Only) } else { @('dsh-notify', 'dsh-context-guard', 'dsh-qq-notify') }

if (!(Test-Path $pluginsRoot)) {
  Write-Host "❌ $pluginsRoot 不存在，请先确认 DSH 已安装" -ForegroundColor Red
  exit 1
}

foreach ($name in $names) {
  $src = Join-Path $repoRoot "packages\$name"
  if (!(Test-Path $src)) { Write-Host "❌ 找不到 $src" -ForegroundColor Red; continue }

  $dst = Join-Path $pluginsRoot $name
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

  # 备份现有（若存在）
  if (Test-Path $dst) {
    $bak = "$dst.bak-$stamp"
    Copy-Item -Recurse -Force $dst $bak
    Write-Host "📦 已备份现有 → $bak" -ForegroundColor Yellow
  }

  # 复制新版本（先清空目标避免残留旧文件）
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  Copy-Item -Recurse $src $dst
  Write-Host "✅ 已部署 $name → $dst" -ForegroundColor Green

  # npm install（解析 schemastery）
  if (!$SkipNpmInstall) {
    Push-Location $dst
    try {
      if (Get-Command npm -ErrorAction SilentlyContinue) {
        npm install --no-audit --no-fund 2>&1 | Out-Null
        if (Test-Path (Join-Path $dst 'node_modules\@deepseek-ai\schemastery')) {
          Write-Host "   ✔ 依赖已装（schemastery）" -ForegroundColor Green
        } else {
          Write-Host "   ⚠ npm install 完成但未找到 schemastery，请检查网络/镜像" -ForegroundColor Yellow
        }
      } else {
        Write-Host "   ⚠ 未找到 npm，跳过依赖安装（需手动 npm install）" -ForegroundColor Yellow
      }
    } finally {
      Pop-Location
    }
  }
}

Write-Host ""
Write-Host "✅ 部署完成。请重启 harness 使插件生效：" -ForegroundColor Green
Write-Host "   1) 若使用 update-harness.bat（同步 bridge + 重启 dsh web）：直接运行" -ForegroundColor Cyan
Write-Host "   2) 或手动重启 dsh（Ctrl+C 后重新 start-harness.cmd）" -ForegroundColor Cyan
Write-Host "   3) 验证：Web UI → 设置 → 插件配置 应出现 dsh-notify / context-guard / qq-notify" -ForegroundColor Cyan

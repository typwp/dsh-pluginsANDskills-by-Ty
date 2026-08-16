# dsh-plugins 设置修改指南

所有插件的设置都通过 **DSH Web UI 的设置页**管理（可视化表单），另有 QQ 端命令与配置文件两种补充途径。改完**即时生效**，无需重启 harness（个别项除外，见下）。

## 方法一：Web UI 设置页（推荐）

> 前提：已安装 `dsh-settings-bridge`（本仓库通用设置桥），否则 rc.6 不会把第三方命名空间暴露给设置页。桥的 allowlist 同样读取 `web_settings_namespaces`，缺省时自动放行 dsh-notify / context-guard / qq-notify。

1. 打开 DSH Web UI（默认 `http://127.0.0.1:8080`）；
2. 进入 **设置** → **插件配置**（或侧边栏的「设置 / Settings」入口）；
3. 左侧选择对应插件命名空间：

| 插件 | 命名空间 | 设置页位置 |
| --- | --- | --- |
| dsh-notify | `dsh-notify` | 设置 → 插件配置 → **dsh-notify** |
| dsh-context-guard | `context-guard` | 设置 → 插件配置 → **context-guard** |
| dsh-qq-notify | `qq-notify` | 设置 → 插件配置 → **qq-notify** |

1. 修改字段（开关/数字/文本/数组/键值对，按 schema 自动渲染对应控件）；
2. 修改**自动保存并立即生效**——插件内部的 `owner.watch()` 会收到新值并热更新。

> 若设置页未出现对应命名空间：请确认插件已部署（见根 README 安装章节）并**重启 harness**。

## 方法二：QQ 命令（仅 dsh-qq-notify）

配置了 `decisionsFilePath`（bridge 决策文件）后，可在 QQ 私聊向机器人发送 `/hn` 命令调整：

```
/hn list                 查看当前所有设置
/hn approval on|off      权限通知开关
/hn complete on|off      完成通知开关
/hn toolOnly on|off      仅工具回合通知
/hn qq on|off            QQ 审批开关
/hn timeout <毫秒>        审批超时
/hn monitor <会话id> [名称]  监控指定会话
/hn unmonitor <会话id>    取消监控
/hn monitor off          恢复监控全部
/hn name <会话id> <名称>   会话命名
```

## 方法三：配置文件（手动）

所有设置最终持久化在 `~/.dsh/settings.yaml`（按命名空间分节）。**不建议直接手改**（可能破坏 YAML 结构导致设置失效），仅在 Web UI 不可用时的兜底手段：

```yaml
# ~/.dsh/settings.yaml（示例）
dsh-notify:
  enabled: true
  channels: [toast, console]
  webhookUrl: ''
  filePath: ''
context-guard:
  enabled: true
  warnThresholds: [0.7, 0.85]
  handoverThreshold: 0.85
qq-notify:
  targetQq: ''
  bridgeUrl: ''
  decisionsFilePath: ''
```

手改后需**重启 harness** 才能生效。

## 生效时机一览

| 修改途径 | 生效时机 |
| --- | --- |
| Web UI 设置页 | 立即（watch 热更新） |
| QQ `/hn` 命令 | 立即 |
| 手改 settings.yaml | 重启后 |

## 升级时的配置保留

从 v0.1 旧版升级：旧版把设置写在 `cordis.patch.yml` 的 `config` 里，新版移到 Web UI。运行 `install.ps1` 会自动迁移旧配置到新 patch（作为启动默认值，Web UI 仍可覆盖），不会丢失 `targetQq`/`bridgeUrl`/`decisionsFilePath` 等。详见根 README「升级旧版」章节。

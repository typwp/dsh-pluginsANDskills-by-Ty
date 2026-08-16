# dsh-settings-bridge

让第三方插件（本仓库的 dsh-notify / dsh-context-guard / dsh-qq-notify）的 settings 命名空间出现在 Web UI 设置页。

## 解决的问题

- rc.6 官方 settings RPC 只暴露内置命名空间，第三方命名空间一律「未暴露」；
- 第三方 dsh-web-ui 设置桥只认它自家全家桶命名空间。

本插件提供：

1. **Host 桥**：`/api/dsh-settings-bridge/*`（loopback-only），把 allowlist 内的任意已注册命名空间经 settings 服务暴露给浏览器；
2. **Client 绑定器**：`ctx.pluginSettings.bind(ns)`，返回兼容 `settingsScope` 的 scope；
3. **JSON 配置卡片**：`ctx.pluginSettingsCards.registerCard(...)`，在 `settings.plugin.item` 槽注册一张 JSON 编辑卡片。

## allowlist

读取 `~/.dsh/settings.yaml` 的 `web_settings_namespaces`。支持包名别名：

```yaml
web_settings_namespaces:
  - dsh-notify
  - context-guard
  - qq-notify
```

该键缺省时回退到 `dsh-notify` / `context-guard` / `qq-notify`。

## 使用

```js
// 任意客户端插件中
const cards = ctx.get("pluginSettingsCards")
if (cards) {
  cards.registerCard({
    namespace: "context-guard",
    title: "上下文防护",
    description: "阈值、输出预算与通知设置。",
    order: 110,
  })
}
```

卡片当前是 JSON 编辑器形态：编辑整个 namespace 的 user 层，保存时经 `settings.replace` 写入。字段级表单可后续再扩展。

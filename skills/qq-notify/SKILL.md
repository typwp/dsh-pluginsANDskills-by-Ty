---
name: qq-notify
description: |
  主动给用户的 QQ 发消息。当用户要求「发到我的QQ」「通知我」「把结果/进度发给我」等时使用。
  通过 qq-bot bridge 的 HTTP 接口发送私聊消息，纯 HTTP 调用，无需额外依赖。
  触发词：发到QQ 发我QQ 通知我 结果发给我 进度发我 微信/QQ 上告诉我
---

# QQ 通知

把指定内容推送到用户的 QQ。适用于用户说「把这个发到我的 QQ」「通知我」「把结果发给我」「进度怎么样了发我一下」等场景。

> 使用前请把下面的 `BRIDGE_URL` 和 `QQ_NUMBER` 替换成你自己的 bridge 地址和目标 QQ 号。

## 发送接口

向 bridge 发送 HTTP POST：

```
POST BRIDGE_URL
Content-Type: application/json

{ "user_id": "QQ_NUMBER", "message": "要发送的内容" }
```

- 示例 bridge 地址：`http://127.0.0.1:3457/send`；
- 成功响应：`{"status":"sent"}`；
- 内容用纯文本，支持换行；QQ 私聊单条建议 500 字以内；
- 不要发送敏感信息（凭证、密钥、token）。

## 注意事项

- bridge 未运行时连接会失败：提示用户先启动 qq-bot bridge 后再试；
- 同一内容最多重试 2 次；
- 用户只是让「继续干活」而非发消息时，不要调用本技能。

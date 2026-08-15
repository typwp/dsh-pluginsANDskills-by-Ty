# Agent 技能（可选）

本目录是给 DSH Agent 使用的技能包，按需复制到 `~/.dsh/skills/` 下即可被识别（每个技能一个目录，目录内含 `SKILL.md`）。

| 技能 | 作用 | 依赖 |
| --- | --- | --- |
| `handover` | 「交代后事」：上下文危险或收尾时写交接文件、沉淀踩坑经验、产出交接摘要 | 无（`memory` 工具可选） |
| `qq-notify` | 主动给用户 QQ 发消息（经 qq-bot bridge HTTP 接口） | 自建 qq-bot bridge |

## 安装

```powershell
# 以 handover 为例
Copy-Item -Recurse .\skills\handover "$env:USERPROFILE\.dsh\skills\handover"
```

`qq-notify` 技能使用前请先编辑 `SKILL.md`，把 `BRIDGE_URL` 与 `QQ_NUMBER` 替换为你自己的 bridge 地址和 QQ 号。

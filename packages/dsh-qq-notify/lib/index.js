/**
 * dsh-qq-notify — QQ 适配层（可选插件）。
 *
 * 角色：把「通用通知」接到 QQ（通过 qq-bot bridge），并提供 QQ 特有交互：
 *   - 订阅 ctx.notify 的消息 → 转发到 QQ（含 context-guard 的预警/拦截消息）
 *   - approval/request 审批双向（QQ 回复「同意/拒绝 dsh-xxx」）
 *   - 会话监控/命名（monitoredSessions / sessionNames）
 *   - /hn 命令（经 bridge 决策文件通道）
 *
 * 不装本插件：dsh-context-guard 照常工作（toast/webhook/日志）。
 * 装但未配置 bridge：自动降级，仅日志。
 */
import { randomBytes } from "node:crypto";
import { statSync, openSync, readSync, closeSync } from "node:fs";
import z from "@deepseek-ai/schemastery";

export const name = "dsh-qq-notify";
export const inject = ["settings"];

export function apply(ctx, config = {}) {
	const base = {
		targetQq: config.targetQq ?? "",
		bridgeUrl: config.bridgeUrl ?? "",
		notifyApproval: config.notifyApproval ?? true,
		notifyComplete: config.notifyComplete ?? true,
		notifyOnToolOnly: config.notifyOnToolOnly ?? true,
		approvalViaQq: config.approvalViaQq ?? true,
		approvalTimeoutMs: config.approvalTimeoutMs ?? 15 * 60 * 1000,
		monitoredSessions: config.monitoredSessions ?? [],
		sessionNames: config.sessionNames ?? {},
		decisionsFilePath: config.decisionsFilePath ?? "",
		tokenPrefix: config.tokenPrefix ?? "dsh-",
		relayNotify: config.relayNotify ?? true,
	};
	const schema = z.object({
		targetQq: z.string(),
		bridgeUrl: z.string(),
		notifyApproval: z.boolean(),
		notifyComplete: z.boolean(),
		notifyOnToolOnly: z.boolean(),
		approvalViaQq: z.boolean(),
		approvalTimeoutMs: z.number(),
		monitoredSessions: z.array(z.string()).default([]),
		sessionNames: z.dict(z.string()).default({}),
		decisionsFilePath: z.string(),
		tokenPrefix: z.string(),
		relayNotify: z.boolean(),
	});
	const settingsOwner = ctx.settings.register("qq-notify", schema, { base });
	let cfg = { ...base, ...settingsOwner.get() };
	settingsOwner.watch((next) => {
		cfg = { ...base, ...next };
		ctx.logger.info(`[qq-notify] 设置已更新: ${JSON.stringify(cfg)}`);
		syncPolling();
	});

	// 桥接可用性：bridgeUrl + targetQq 都配置才视为启用；否则降级日志
	function bridgeEnabled() {
		return Boolean(cfg.bridgeUrl && cfg.targetQq);
	}

	const toolTurns = new Map();
	const key = (sid, turn) => sid + ":" + turn;
	const pendingApprovals = new Map();
	let decisionsOffset = 0;
	let pollTimer = null;
	let pollPath = "";

	// 会话是否被监控（空列表=监控全部；支持短 id 前缀匹配）
	function isMonitored(sid) {
		const list = cfg.monitoredSessions ?? [];
		if (!list.length) return true;
		return list.some((x) => sid === x || sid.startsWith(x));
	}
	// 会话显示名：sessionNames[id] 优先，其次短 id
	function sessionLabel(sid) {
		const name = cfg.sessionNames?.[sid] ?? cfg.sessionNames?.[sid.slice(0, 8)];
		return `session-${name ?? sid.slice(0, 8)}`;
	}

	async function send(message) {
		if (!bridgeEnabled()) return false;
		try {
			const res = await fetch(cfg.bridgeUrl, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ user_id: String(cfg.targetQq), message }),
				signal: AbortSignal.timeout(5000),
			});
			if (!res.ok)
				ctx.logger.warn(`[qq-notify] bridge 响应异常: ${res.status}`);
			return res.ok;
		} catch (e) {
			ctx.logger.warn(`[qq-notify] 发送失败: ${e.message}`);
			return false;
		}
	}

	function summarize() {
		const label = {
			targetQq: "目标QQ",
			bridgeUrl: "bridge地址",
			notifyApproval: "权限通知",
			notifyComplete: "完成通知",
			notifyOnToolOnly: "仅工具回合",
			approvalViaQq: "QQ审批",
			approvalTimeoutMs: "审批超时(ms)",
			monitoredSessions: "监控会话",
			sessionNames: "会话别名",
			relayNotify: "转发通知",
		};
		const lines = Object.entries(cfg)
			.map(([k, v]) => {
				if (k === "monitoredSessions")
					return `  ${label[k]}: ${(v ?? []).length ? v.join(", ") : "(全部)"}`;
				if (k === "sessionNames") {
					const pairs = Object.entries(v ?? {});
					return `  ${label[k]}: ${pairs.length ? pairs.map(([i, n]) => `${i}=${n}`).join(", ") : "(无)"}`;
				}
				if (k === "decisionsFilePath" || k === "tokenPrefix") return null;
				return `  ${label[k] ?? k}: ${typeof v === "boolean" ? (v ? "开" : "关") : v}`;
			})
			.filter(Boolean);
		return lines.join("\n");
	}

	function pollDecisions() {
		const decisionsFile = cfg.decisionsFilePath;
		if (!decisionsFile) return;
		try {
			const stat = statSync(decisionsFile);
			if (stat.size < decisionsOffset) decisionsOffset = 0;
			if (stat.size <= decisionsOffset) return;
			const fd = openSync(decisionsFile, "r");
			const buf = Buffer.alloc(stat.size - decisionsOffset);
			readSync(fd, buf, 0, buf.length, decisionsOffset);
			closeSync(fd);
			decisionsOffset = stat.size;
			for (const line of buf.toString("utf8").split("\n")) {
				if (!line.trim()) continue;
				try {
					const rec = JSON.parse(line);
					if (rec.type === "approval" && pendingApprovals.has(rec.token)) {
						const outcome =
							rec.outcome === "allowed" ? "allowed-once" : "rejected";
						pendingApprovals.get(rec.token).resolve(outcome);
						pendingApprovals.delete(rec.token);
					} else if (rec.type === "settings") {
						if (rec.action === "status") {
							send(`📊 Harness 通知设置\n${summarize()}`);
						} else if (rec.action === "set") {
							try {
								ctx.settings.mutate("qq-notify", [
									{ op: "set", path: [rec.key], value: rec.value },
								]);
								send(`✅ 已更新 ${rec.key} = ${rec.value}\n${summarize()}`);
							} catch (e) {
								send(`❌ 设置更新失败: ${e.message}`);
							}
						} else if (rec.action === "monitor-add") {
							const cur = [...(cfg.monitoredSessions ?? [])];
							if (!cur.includes(rec.id)) cur.push(rec.id);
							const ops = [
								{ op: "set", path: ["monitoredSessions"], value: cur },
							];
							if (rec.name)
								ops.push({
									op: "set",
									path: ["sessionNames"],
									value: {
										...(cfg.sessionNames ?? {}),
										[rec.id]: rec.name,
									},
								});
							try {
								ctx.settings.mutate("qq-notify", ops);
								send(
									`✅ 已监控会话 ${rec.id}${rec.name ? `（${rec.name}）` : ""}`,
								);
							} catch (e) {
								send(`❌ 监控设置失败: ${e.message}`);
							}
						} else if (rec.action === "monitor-remove") {
							const cur = (cfg.monitoredSessions ?? []).filter(
								(x) => x !== rec.id,
							);
							try {
								ctx.settings.mutate("qq-notify", [
									{ op: "set", path: ["monitoredSessions"], value: cur },
								]);
								send(`✅ 已取消监控会话 ${rec.id}`);
							} catch (e) {
								send(`❌ 监控设置失败: ${e.message}`);
							}
						} else if (rec.action === "monitor-clear") {
							try {
								ctx.settings.mutate("qq-notify", [
									{ op: "set", path: ["monitoredSessions"], value: [] },
								]);
								send(`✅ 已恢复监控全部会话`);
							} catch (e) {
								send(`❌ 监控设置失败: ${e.message}`);
							}
						} else if (rec.action === "name-set") {
							try {
								ctx.settings.mutate("qq-notify", [
									{
										op: "set",
										path: ["sessionNames"],
										value: {
											...(cfg.sessionNames ?? {}),
											[rec.id]: rec.name,
										},
									},
								]);
								send(`✅ 会话 ${rec.id} 已命名：${rec.name}`);
							} catch (e) {
								send(`❌ 命名失败: ${e.message}`);
							}
						}
					}
				} catch {}
			}
		} catch {}
	}

	/**
	 * 按 cfg.decisionsFilePath 启停轮询：设置热更新后能挂载新路径，
	 * 新路径从文件末尾开始读取，避免重放历史 decisions。
	 */
	function syncPolling() {
		const file = cfg.decisionsFilePath;
		if (file === pollPath) return;
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		pollPath = file;
		if (!file) return;
		try {
			decisionsOffset = statSync(file).size;
		} catch {
			decisionsOffset = 0;
		}
		pollTimer = setInterval(pollDecisions, 1000);
		pollTimer.unref?.();
	}

	function waitDecision(token, timeoutMs) {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				pendingApprovals.delete(token);
				resolve(null);
			}, timeoutMs);
			pendingApprovals.set(token, {
				resolve: (outcome) => {
					clearTimeout(timer);
					resolve(outcome);
				},
			});
		});
	}

	// ── 注册为 dsh-notify 的 'qq' 通道：context-guard 等插件的通知自动转发 QQ ──
	// 通过 ctx.notify.registerChannel('qq', sender) 接入；dsh-notify 未装时
	// 静默跳过（本插件仍提供审批/会话监控等独立能力）。用 internal/service
	// 事件监听 notify 出现，保证与 dsh-notify 的加载顺序无关。
	let unregisterQqChannel = null;
	function attachQqChannel() {
		const notifyService = ctx.get?.("notify");
		if (!notifyService?.registerChannel) return;
		if (unregisterQqChannel) return; // 已注册
		unregisterQqChannel = notifyService.registerChannel(
			"qq",
			async (message, level) => {
				const emoji = level === "error" ? "🚫" : level === "warn" ? "⚠️" : "📣";
				const ok = await send(`${emoji} ${message}`);
				return ok;
			},
		);
		ctx.logger.info("[qq-notify] 已注册为 dsh-notify 的 qq 通道");
	}
	attachQqChannel();
	const offNotifyService = ctx.on("internal/service", (name) => {
		if (name !== "notify") return;
		attachQqChannel();
	});

	// ── approval/request answerer（prepend；GUI 与 QQ 并行，先到先得；非监控会话只走 GUI）──
	ctx.on(
		"approval/request",
		async (req, next) => {
			if (!cfg.approvalViaQq) return next();
			if (!bridgeEnabled()) return next();
			if (req.signal?.aborted === true) return "cancelled";
			const sessionId = req.agent?.session?.id ?? "?";
			if (!isMonitored(sessionId)) return next(); // 未监控会话：QQ 不打扰，GUI 正常
			const token = cfg.tokenPrefix + randomBytes(6).toString("hex");
			const lines = [
				`🔔 Harness 需要权限确认（${token}）`,
				`会话: ${sessionLabel(sessionId)}`,
				`工具: ${req.toolName}`,
			];
			if (req.reason) lines.push(`原因: ${req.reason.slice(0, 300)}`);
			lines.push(
				"",
				`在 GUI 确认，或回复「同意 ${token}」/「拒绝 ${token}」，先到先得`,
			);
			const ok = await send(lines.join("\n"));
			if (!ok) return next();
			const qqPromise = waitDecision(token, cfg.approvalTimeoutMs);
			const guiPromise = next();
			const realOutcomes = new Set(["allowed-once", "rejected", "cancelled"]);
			return await new Promise((resolve) => {
				let settled = false;
				const finish = (outcome, source) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					if (source === "gui") {
						const label =
							outcome === "allowed-once"
								? "✅ 已在 GUI 确认"
								: outcome === "rejected"
									? "❌ 已在 GUI 拒绝"
									: "已取消";
						send(`${label}（${token}），无需在 QQ 重复回复`);
					}
					resolve(outcome);
				};
				const timer = setTimeout(
					() => finish("rejected", "timeout"),
					cfg.approvalTimeoutMs,
				);
				qqPromise.then((o) => {
					if (o != null) finish(o, "qq");
				});
				guiPromise.then((o) => {
					if (realOutcomes.has(o)) finish(o, "gui");
				});
			});
		},
		{ prepend: true },
	);

	// ── session/event 通知（仅监控会话；带会话别名） ──
	ctx.on("session/event", (session, event) => {
		if (!bridgeEnabled()) return;
		const sid = session?.id ?? "?";
		const type = event?.type;
		const data = event?.data ?? {};
		try {
			if (!isMonitored(sid)) return;
			if (
				!cfg.approvalViaQq &&
				cfg.notifyApproval &&
				type === "approval/asked"
			) {
				const tool = data.toolName ?? data.name ?? "";
				const reason = typeof data.reason === "string" ? data.reason : "";
				const detail = [
					tool && `工具: ${tool}`,
					reason && `原因: ${reason.slice(0, 200)}`,
				]
					.filter(Boolean)
					.join("\n");
				send(
					`🔔 Harness 需要权限确认\n会话: ${sessionLabel(sid)}\n${detail || "（详见 GUI 弹窗）"}`,
				);
			} else if (type === "turn/start") {
				if (data.turn !== undefined) toolTurns.set(key(sid, data.turn), false);
			} else if (type === "tool/call") {
				if (data.turn !== undefined) toolTurns.set(key(sid, data.turn), true);
			} else if (cfg.notifyComplete && type === "turn/end") {
				const k = key(sid, data.turn);
				const hasTool = toolTurns.get(k) === true;
				toolTurns.delete(k);
				if (
					data.reason?.kind === "completed" &&
					(!cfg.notifyOnToolOnly || hasTool)
				) {
					send(
						`✅ Harness 任务完成\n会话: ${sessionLabel(sid)}\n回合: ${data.turn}${hasTool ? "" : "（纯对话）"}`,
					);
				}
			}
		} catch (e) {
			ctx.logger.warn(`[qq-notify] 处理事件异常: ${e.message}`);
		}
	});

	// 会话销毁时清理该会话的 toolTurns 记录，避免长期运行后残留。
	ctx.on("session/disposed", (session) => {
		const sid = session?.id ?? "?";
		for (const k of [...toolTurns.keys()])
			if (k.startsWith(sid + ":")) toolTurns.delete(k);
	});

	syncPolling();

	// 暴露显式 QQ 发送能力给其他插件：ctx.qqNotify.send(message)
	const qqService = { send, bridgeEnabled };
	const unprovide = ctx.provide("qqNotify", qqService);

	return () => {
		if (pollTimer) clearInterval(pollTimer);
		offNotifyService();
		if (unregisterQqChannel) unregisterQqChannel();
		unprovide();
		for (const p of pendingApprovals.values()) p.resolve(null);
		pendingApprovals.clear();
	};
}

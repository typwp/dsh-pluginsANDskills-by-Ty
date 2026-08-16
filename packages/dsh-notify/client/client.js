// client/client.js — dsh-notify 浏览器端：轮询 /api/dsh-notify/poll，
// 在 Web UI 右下角显示 toast 浮层。零构建 vanilla JS。
//
// 机制（与 dsh-memento client 同款）：host 端 dsh.client 扫描把本文件作为
// classic script 注入 __DSH_BOOT__ 图，执行时经 window.__ModuleLoader__.load
// 注册工厂；apply 启动轮询定时器。

(() => {
	if (
		typeof window === "undefined" ||
		!window.__ModuleLoader__ ||
		!window.__ModuleLoader__.load
	)
		return;
	window.__ModuleLoader__.load({
		id: "dsh-notify",
		factory: () => ({
			name: "dsh-notify-client",
			inject: [],
			apply: (ctx) => {
				startToastLoop();
				const cards = ctx.get?.("pluginSettingsCards");
				if (cards) {
					cards.registerCard({
						id: "plugin-settings-dsh-notify",
						namespace: "dsh-notify",
						title: "通用通知",
						description: "toast / webhook / 文件 / 日志通道设置（JSON）。",
						order: 100,
					});
				}
			},
		}),
	});
})();

const POLL_URL = "/api/dsh-notify/poll";
const POLL_INTERVAL = 2000;

let lastSeq = 0;
let timer = null;
let host = null;

const COLORS = {
	info: "#3b82f6",
	warn: "#f59e0b",
	error: "#ef4444",
};

/** 创建/复用 toast 容器（右下角固定浮层）。 */
function ensureHost() {
	if (host && host.isConnected) return host;
	host = document.createElement("div");
	host.id = "dsh-notify-toasts";
	Object.assign(host.style, {
		position: "fixed",
		right: "16px",
		bottom: "16px",
		zIndex: "2147483000",
		display: "flex",
		flexDirection: "column",
		gap: "8px",
		maxWidth: "360px",
		pointerEvents: "none",
	});
	document.body.appendChild(host);
	return host;
}

function showToast(message, level) {
	const el = document.createElement("div");
	Object.assign(el.style, {
		background: "rgba(17, 24, 39, 0.96)",
		color: "#f3f4f6",
		borderLeft: `4px solid ${COLORS[level] ?? COLORS.info}`,
		borderRadius: "8px",
		padding: "10px 14px",
		fontSize: "13px",
		lineHeight: "1.5",
		boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
		pointerEvents: "auto",
		animation: "dsh-notify-in 0.18s ease-out",
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
	});
	el.textContent = message;

	// 动画 keyframes（只注入一次）
	if (!document.getElementById("dsh-notify-style")) {
		const style = document.createElement("style");
		style.id = "dsh-notify-style";
		style.textContent =
			"@keyframes dsh-notify-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }";
		document.head.appendChild(style);
	}

	ensureHost().appendChild(el);
	setTimeout(() => {
		el.style.transition = "opacity 0.3s, transform 0.3s";
		el.style.opacity = "0";
		el.style.transform = "translateY(8px)";
		setTimeout(() => el.remove(), 320);
	}, 6000);
}

async function poll() {
	try {
		const res = await fetch(`${POLL_URL}?after=${lastSeq}`, {
			signal: AbortSignal.timeout(4000),
		});
		if (!res.ok) return;
		const data = await res.json();
		if (!data || !Array.isArray(data.items)) return;
		for (const item of data.items) {
			if (item.seq > lastSeq) {
				lastSeq = item.seq;
				if (item.message) showToast(item.message, item.level ?? "info");
			}
		}
		if (typeof data.latest === "number" && data.latest > lastSeq)
			lastSeq = data.latest;
	} catch {
		// 网络抖动/路由未就绪：静默跳过，下轮再试
	}
}

function startToastLoop() {
	if (timer) return;
	lastSeq = 0;
	poll();
	timer = setInterval(poll, POLL_INTERVAL);
}

// 页面卸载时清理（SPA 内插件重载场景）
window.addEventListener("beforeunload", () => {
	if (timer) clearInterval(timer);
	timer = null;
});

/**
 * dsh-settings-bridge — 通用第三方插件设置桥。
 *
 * rc.6 的官方 settings RPC 只暴露内置命名空间；dsh-web-ui 的桥则只认
 * 它们自家全家桶命名空间。这个插件把「任意已注册的 settings 命名空间」
 * 通过一个 loopback-only HTTP 桥暴露给浏览器端，使第三方插件（例如本仓库
 * 的 dsh-notify / dsh-context-guard / dsh-qq-notify）也能拥有 Web UI 设置页。
 *
 * allowlist 读取 $DSH_HOME/settings.yaml 的 `web_settings_namespaces`；
 * 该键缺省时回退到本仓库插件的默认列表。允许使用包名别名（如
 * `dsh-context-guard` → `context-guard`）或直接写命名空间名。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const name = "dsh-settings-bridge";
export const inject = ["settings", "webServer"];

const BRIDGE_PREFIX = "/api/dsh-settings-bridge";
const NAMESPACE_RE = /^[a-z][a-z0-9-]*$/;

/** 包名/插件 id → settings 命名空间。 */
const NAMESPACE_ALIASES = {
	"dsh-notify": "dsh-notify",
	notify: "dsh-notify",
	"dsh-context-guard": "context-guard",
	"context-guard": "context-guard",
	"dsh-qq-notify": "qq-notify",
	"qq-notify": "qq-notify",
};

/** allowlist 缺省时仍暴露的命名空间（本仓库插件开箱即用）。 */
const DEFAULT_NAMESPACES = ["dsh-notify", "context-guard", "qq-notify"];

/** 从 settings.yaml 中提取 web_settings_namespaces（支持 block list 和 inline flow）。 */
function parseAllowlist(text) {
	if (text.trim() === "") return [];
	const inline = /(?:^|\n)\s*web_settings_namespaces\s*:\s*\[([^\]]*)\]/m.exec(
		text,
	);
	if (inline !== null) {
		return inline[1]
			.split(",")
			.map((part) => stripQuotes(part))
			.filter((name) => name !== "");
	}
	const lines = text.split(/\r?\n/);
	const start = lines.findIndex((line) =>
		/^\s*web_settings_namespaces\s*:\s*$/.test(line.trim()),
	);
	if (start < 0) return [];
	const entries = [];
	for (const line of lines.slice(start + 1)) {
		if (line.trim() === "") break;
		if (!/^\s/.test(line)) break;
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) continue;
		const value = trimmed.startsWith("- ") ? trimmed.slice(2).trim() : trimmed;
		if (value === "") continue;
		const name = stripQuotes(value.split(":")[0]);
		if (name !== "") entries.push(name);
	}
	return entries;
}

function stripQuotes(value) {
	const trimmed = value.trim();
	if (
		trimmed.length >= 2 &&
		(trimmed[0] === "'" || trimmed[0] === '"') &&
		trimmed[trimmed.length - 1] === trimmed[0]
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

/** Loopback-only 请求守卫（与 dsh-web-ui-settings 保持一致）。 */
function isLoopbackRequest(req) {
	const address = req.socket?.remoteAddress;
	if (
		address !== "127.0.0.1" &&
		address !== "::1" &&
		address !== "::ffff:127.0.0.1"
	)
		return false;
	const host = req.headers?.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (
		hostUrl.hostname !== "127.0.0.1" &&
		hostUrl.hostname !== "localhost" &&
		hostUrl.hostname !== "[::1]"
	)
		return false;
	if (req.headers?.["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers?.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

function writeJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer",
	});
	res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > 64 * 1024) return undefined;
		chunks.push(buffer);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return undefined;
	}
}

/** 把 settings 服务的 descriptor 投影成桥接 wire view。 */
function toView(descriptor) {
	return {
		ns: String(descriptor.ns),
		schema: descriptor.schema,
		value: descriptor.value,
		...(descriptor.base === undefined ? {} : { base: descriptor.base }),
		...(descriptor.user === undefined ? {} : { user: descriptor.user }),
		revision: descriptor.revision,
	};
}

function makeBridgeHandlers(settings, readSettingsYaml) {
	const descriptors = () => settings.describe({ redactSecrets: true });
	const registered = () =>
		descriptors().map((descriptor) => String(descriptor.ns));

	const allowlisted = () => {
		const requested = parseAllowlist(readSettingsYaml());
		const wanted = requested.length === 0 ? DEFAULT_NAMESPACES : requested;
		const known = new Set(registered());
		const resolved = new Set();
		for (const entry of wanted) {
			const key = entry.trim();
			if (key === "") continue;
			const ns = NAMESPACE_ALIASES[key] ?? (known.has(key) ? key : undefined);
			if (ns !== undefined && known.has(ns)) resolved.add(ns);
		}
		return descriptors()
			.filter((descriptor) => resolved.has(String(descriptor.ns)))
			.map(toView);
	};

	const viewFor = (ns) => {
		const view = allowlisted().find((descriptor) => descriptor.ns === ns);
		if (view !== undefined) return view;
		const descriptor = descriptors().find(
			(candidate) => String(candidate.ns) === ns,
		);
		return descriptor === undefined ? undefined : toView(descriptor);
	};

	return {
		async describe() {
			return {
				ok: true,
				value: {
					namespaces: allowlisted(),
					writable: settings.writable !== false,
				},
			};
		},
		async mutate(body) {
			if (
				body === null ||
				typeof body !== "object" ||
				typeof body.ns !== "string" ||
				!Array.isArray(body.ops)
			) {
				return {
					ok: false,
					code: "settings-rejected",
					message: "malformed bridge settings request",
				};
			}
			const { ns, ops } = body;
			if (!NAMESPACE_RE.test(ns))
				return {
					ok: false,
					code: "settings-rejected",
					message: `settings namespace "${ns}" is invalid`,
				};
			if (!allowlisted().some((descriptor) => descriptor.ns === ns)) {
				return {
					ok: false,
					code: "settings-not-exposed",
					message: `settings namespace "${ns}" is not exposed to configuration clients`,
				};
			}
			const expectedRevision =
				typeof body.expectedRevision === "number"
					? body.expectedRevision
					: undefined;
			try {
				await settings.mutate(ns, ops, expectedRevision);
			} catch (error) {
				return {
					ok: false,
					code: "settings-rejected",
					message: error instanceof Error ? error.message : String(error),
				};
			}
			const view = viewFor(ns);
			if (view === undefined)
				return {
					ok: false,
					code: "internal",
					message: `settings namespace "${ns}" was disposed after the mutate`,
				};
			return { ok: true, value: view };
		},
		async replace(body) {
			if (
				body === null ||
				typeof body !== "object" ||
				typeof body.ns !== "string" ||
				!body.section ||
				typeof body.section !== "object" ||
				Array.isArray(body.section)
			) {
				return {
					ok: false,
					code: "settings-rejected",
					message: "malformed bridge settings replace request",
				};
			}
			const { ns, section } = body;
			if (!NAMESPACE_RE.test(ns))
				return {
					ok: false,
					code: "settings-rejected",
					message: `settings namespace "${ns}" is invalid`,
				};
			if (!allowlisted().some((descriptor) => descriptor.ns === ns)) {
				return {
					ok: false,
					code: "settings-not-exposed",
					message: `settings namespace "${ns}" is not exposed to configuration clients`,
				};
			}
			const expectedRevision =
				typeof body.expectedRevision === "number"
					? body.expectedRevision
					: undefined;
			try {
				await settings.replace(ns, section, expectedRevision);
			} catch (error) {
				return {
					ok: false,
					code: "settings-rejected",
					message: error instanceof Error ? error.message : String(error),
				};
			}
			const view = viewFor(ns);
			if (view === undefined)
				return {
					ok: false,
					code: "internal",
					message: `settings namespace "${ns}" was disposed after the replace`,
				};
			return { ok: true, value: view };
		},
	};
}

function makeBridgeRoutes(deps) {
	const handlers = makeBridgeHandlers(deps.settings, deps.readSettingsYaml);
	const guard = (req, res) => {
		if (!isLoopbackRequest(req)) {
			writeJson(res, 403, { error: "loopback requests only" });
			return false;
		}
		if (req.method !== "POST") {
			writeJson(res, 405, { error: "method not allowed" });
			return false;
		}
		return true;
	};
	return [
		{
			kind: "exact",
			path: `${BRIDGE_PREFIX}/describe`,
			handler: async (req, res) => {
				if (!guard(req, res)) return;
				writeJson(res, 200, await handlers.describe());
			},
		},
		{
			kind: "exact",
			path: `${BRIDGE_PREFIX}/mutate`,
			handler: async (req, res) => {
				if (!guard(req, res)) return;
				const body = await readJsonBody(req);
				if (body === undefined) {
					writeJson(res, 400, {
						ok: false,
						code: "settings-rejected",
						message: "unreadable JSON body",
					});
					return;
				}
				writeJson(res, 200, await handlers.mutate(body));
			},
		},
		{
			kind: "exact",
			path: `${BRIDGE_PREFIX}/replace`,
			handler: async (req, res) => {
				if (!guard(req, res)) return;
				const body = await readJsonBody(req);
				if (body === undefined) {
					writeJson(res, 400, {
						ok: false,
						code: "settings-rejected",
						message: "unreadable JSON body",
					});
					return;
				}
				writeJson(res, 200, await handlers.replace(body));
			},
		},
	];
}

export function apply(ctx) {
	const settingsYamlPath =
		ctx.settings.documentPath ?? join(homedir(), ".dsh", "settings.yaml");
	ctx.effect(() => {
		const disposers = makeBridgeRoutes({
			settings: ctx.settings,
			readSettingsYaml: () => {
				try {
					return readFileSync(settingsYamlPath, "utf8");
				} catch {
					return "";
				}
			},
		}).map((route) => ctx.webServer.register(route));
		return () => {
			for (const dispose of disposers) dispose();
		};
	}, "dsh-settings-bridge: routes");
}

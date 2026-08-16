(() => {
	if (
		typeof window === "undefined" ||
		!window.__ModuleLoader__ ||
		!window.__ModuleLoader__.load
	)
		return;

	window.__ModuleLoader__.load({
		id: "dsh-qq-notify",
		factory: () => ({
			name: "dsh-qq-notify-client",
			inject: [],
			apply: (ctx) => {
				const register = () => {
					const cards = ctx.get("pluginSettingsCards");
					if (!cards) return false; // 未安装 dsh-settings-bridge 时静默跳过
					cards.registerCard({
						id: "plugin-settings-qq-notify",
						namespace: "qq-notify",
						title: "QQ 通知",
						description: "目标 QQ、bridge 地址、审批与完成通知设置。",
						order: 120,
						fields: [
							{
								key: "targetQq",
								label: "目标 QQ 号",
								type: "text",
								placeholder: "填写后 bridge 才会启用",
							},
							{
								key: "bridgeUrl",
								label: "Bridge 发送地址",
								type: "text",
								placeholder: "http://127.0.0.1:3457/send",
							},
							{
								key: "relayNotify",
								label: "转发 dsh-notify 消息到 QQ",
								type: "boolean",
							},
							{
								key: "notifyApproval",
								label: "权限请求通知",
								type: "boolean",
							},
							{
								key: "notifyComplete",
								label: "任务完成通知",
								type: "boolean",
							},
							{
								key: "notifyOnToolOnly",
								label: "仅工具回合发完成通知",
								type: "boolean",
							},
							{
								key: "approvalViaQq",
								label: "QQ 审批（回复同意/拒绝）",
								type: "boolean",
							},
							{
								key: "approvalTimeoutMs",
								label: "审批超时（毫秒）",
								type: "number",
								placeholder: "900000",
							},
							{
								key: "monitoredSessions",
								label: "监控会话（空=不监控任何会话）",
								type: "list",
								placeholder: "多个会话 ID 用逗号分隔；留空表示默认不打扰",
							},
							{
								key: "sessionNames",
								label: "会话别名（JSON）",
								type: "dict",
								placeholder: '{"session-abc123": "工作会话"}',
							},
							{
								key: "decisionsFilePath",
								label: "决策文件路径（/hn 命令）",
								type: "text",
								placeholder: "空=禁用 /hn 命令",
							},
							{
								key: "tokenPrefix",
								label: "审批令牌前缀",
								type: "text",
								placeholder: "dsh-",
							},
						],
					});
					return true;
				};
				if (!register()) {
					// dsh-settings-bridge 的 client 可能晚于本插件激活；等服务出现后补注册。
					ctx.on("internal/service", (name) => {
						if (name === "pluginSettingsCards") register();
					});
				}

				// 会话右键菜单（重命名/分叉/归档下方）注入 QQ 监控与别名两个词条。
				// 依赖对工作区客户端的一处本地补丁：其菜单会读取
				// window.__DSH_SESSION_MENU_ITEMS__ / __DSH_SESSION_MENU_ON_SELECT__。
				const setupSessionMenu = () => {
					const pluginSettings = ctx.get("pluginSettings");
					if (!pluginSettings?.bind) return false;
					const scope = pluginSettings.bind("qq-notify");
					// 工作区会话列表用它决定是否在标题右侧显示 👁 监控标记。
					window.__DSH_SESSION_MONITORED__ = (sid) => {
						const snap = scope.getSnapshot();
						const value = snap?.value ?? {};
						const monitored = Array.isArray(value.monitoredSessions)
							? value.monitoredSessions
							: [];
						return monitored.some((x) => sid === x || sid.startsWith(x));
					};
					window.__DSH_SESSION_MENU_ITEMS__ = (node) => {
						const sid = node?.id ?? "";
						if (!sid) return [];
						const snap = scope.getSnapshot();
						const value = snap?.value ?? {};
						const monitored = Array.isArray(value.monitoredSessions)
							? value.monitoredSessions
							: [];
						const active = monitored.some(
							(x) => sid === x || sid.startsWith(x),
						);
						return [
							{
								id: "qq-monitor-toggle",
								label: active
									? "QQ 通知：取消监控此会话"
									: "QQ 通知：监控此会话",
							},
							{
								id: "qq-alias",
								label: "QQ 通知：设置会话别名",
							},
						];
					};
					window.__DSH_SESSION_MENU_ON_SELECT__ = async (id, node) => {
						const sid = node?.id ?? "";
						if (!sid) return;
						const snap = scope.getSnapshot();
						const value = snap?.value ?? {};
						if (id === "qq-monitor-toggle") {
							const monitored = Array.isArray(value.monitoredSessions)
								? value.monitoredSessions
								: [];
							const active = monitored.some(
								(x) => sid === x || sid.startsWith(x),
							);
							const next = active
								? monitored.filter((x) => x !== sid && !sid.startsWith(x))
								: [...monitored, sid];
							await scope.mutate([
								{ op: "set", path: ["monitoredSessions"], value: next },
							]);
						} else if (id === "qq-alias") {
							const previous = value.sessionNames?.[sid] ?? "";
							const name = window.prompt(
								"输入 QQ 通知里的会话别名（留空清除）：",
								previous,
							);
							if (name === null) return;
							const sessionNames = { ...(value.sessionNames ?? {}) };
							if (name.trim() === "") delete sessionNames[sid];
							else sessionNames[sid] = name.trim();
							await scope.mutate([
								{ op: "set", path: ["sessionNames"], value: sessionNames },
							]);
						}
					};
					return true;
				};
				if (!setupSessionMenu()) {
					ctx.on("internal/service", (name) => {
						if (name === "pluginSettings") setupSessionMenu();
					});
				}
			},
		}),
	});
})();

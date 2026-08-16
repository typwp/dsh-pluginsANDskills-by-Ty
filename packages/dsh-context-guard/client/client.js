(() => {
	if (
		typeof window === "undefined" ||
		!window.__ModuleLoader__ ||
		!window.__ModuleLoader__.load
	)
		return;

	window.__ModuleLoader__.load({
		id: "dsh-context-guard",
		factory: () => ({
			name: "dsh-context-guard-client",
			inject: [],
			apply: (ctx) => {
				const register = () => {
					const cards = ctx.get("pluginSettingsCards");
					if (!cards) return false; // 未安装 dsh-settings-bridge 时静默跳过
					cards.registerCard({
						id: "plugin-settings-context-guard",
						namespace: "context-guard",
						title: "上下文防护",
						description: "模型上限、输出预算、预警阈值与通知设置。",
						order: 110,
						fields: [
							{
								key: "enabled",
								label: "启用上下文防护",
								type: "boolean",
							},
							{
								key: "modelLimit",
								label: "模型上下文上限",
								type: "number",
								placeholder: "1048576",
							},
							{
								key: "defaultOutputBudget",
								label: "默认输出预算",
								type: "number",
								placeholder: "256000",
							},
							{
								key: "warnThresholds",
								label: "预警阈值（0-1）",
								type: "list",
								placeholder: "多个用逗号分隔，例如 0.7, 0.85",
							},
							{
								key: "handoverThreshold",
								label: "交代后事阈值（0-1，0=关闭）",
								type: "number",
								placeholder: "0.85",
							},
							{
								key: "modelLimits",
								label: "按模型上限（JSON）",
								type: "dict",
								placeholder: '{"deepseek-chat": 1048576}',
							},
							{
								key: "notifyLevel",
								label: "通知级别",
								type: "text",
								placeholder: "warn / error / info",
							},
							{
								key: "notifyChannels",
								label: "通知通道（空=全局）",
								type: "list",
								placeholder: "例如 qq, webhook",
							},
						],
					});
					return true;
				};
				if (register()) return;
				// dsh-settings-bridge 的 client 可能晚于本插件激活；等服务出现后补注册。
				ctx.on("internal/service", (name) => {
					if (name === "pluginSettingsCards") register();
				});
			},
		}),
	});
})();

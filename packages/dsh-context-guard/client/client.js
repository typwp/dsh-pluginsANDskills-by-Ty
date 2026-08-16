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
				const cards = ctx.get("pluginSettingsCards");
				if (!cards) return; // 未安装 dsh-settings-bridge 时静默跳过
				cards.registerCard({
					id: "plugin-settings-context-guard",
					namespace: "context-guard",
					title: "上下文防护",
					description: "模型上限、输出预算、预警阈值与通知设置（JSON）。",
					order: 110,
				});
			},
		}),
	});
})();

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
				const cards = ctx.get("pluginSettingsCards");
				if (!cards) return; // 未安装 dsh-settings-bridge 时静默跳过
				cards.registerCard({
					id: "plugin-settings-qq-notify",
					namespace: "qq-notify",
					title: "QQ 通知",
					description: "目标 QQ、bridge 地址、审批与完成通知设置（JSON）。",
					order: 120,
				});
			},
		}),
	});
})();

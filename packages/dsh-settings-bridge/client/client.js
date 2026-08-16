(() => {
	if (
		typeof window === "undefined" ||
		!window.__ModuleLoader__ ||
		!window.__ModuleLoader__.load
	)
		return;

	window.__ModuleLoader__.load({
		id: "dsh-settings-bridge",
		factory: (require) => {
			const react = require("react");
			const {
				createSnapshotStore,
			} = require("@deepseek-ai/dsh-client-runtime/client");
			const { Service } = require("@deepseek-ai/cordis");

			const BRIDGE_PREFIX = "/api/dsh-settings-bridge";

			async function bridgeFetch(path, body) {
				const response = await fetch(BRIDGE_PREFIX + path, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});
				if (!response.ok) {
					return {
						result: {
							ok: false,
							code: "internal",
							message: `bridge HTTP ${response.status}`,
						},
					};
				}
				return { result: await response.json() };
			}

			/** settingsScope-compatible controller backed by the bridge. */
			class BridgeScopeController {
				constructor(namespace) {
					this.namespace = namespace;
					this.store = createSnapshotStore({
						status: "loading",
						value: undefined,
						base: undefined,
						user: undefined,
						revision: undefined,
						writable: false,
					});
				}
				getSnapshot() {
					return this.store.getSnapshot();
				}
				subscribe(listener) {
					return this.store.subscribe(listener);
				}
				async load() {
					let envelope;
					try {
						envelope = await bridgeFetch("/describe", {});
					} catch {
						this.store.set({ status: "unavailable", writable: false });
						return;
					}
					if (!envelope.result.ok) {
						this.store.set({ status: "unavailable", writable: false });
						return;
					}
					const { namespaces, writable } = envelope.result.value;
					const view = namespaces.find(
						(candidate) => candidate.ns === this.namespace,
					);
					if (view === undefined) {
						this.store.set({ status: "unavailable", writable });
						return;
					}
					this.accept(view, writable);
				}
				accept(view, writable) {
					this.store.set({
						status: "ready",
						value: view.value,
						base: view.base,
						user: view.user,
						revision: view.revision,
						writable,
					});
				}
				set(field, value) {
					return this.mutate([{ op: "set", path: [field], value }]);
				}
				unset(field) {
					return this.mutate([{ op: "unset", path: [field] }]);
				}
				async mutate(ops) {
					const revision = this.store.getSnapshot().revision;
					const envelope = await bridgeFetch("/mutate", {
						ns: this.namespace,
						ops,
						...(revision === undefined ? {} : { expectedRevision: revision }),
					});
					if (envelope.result.ok) {
						this.accept(
							envelope.result.value,
							this.store.getSnapshot().writable,
						);
					} else {
						await this.load();
						throw new Error(
							envelope.result.message ?? "settings bridge mutate failed",
						);
					}
				}
				async replace(section) {
					const revision = this.store.getSnapshot().revision;
					const envelope = await bridgeFetch("/replace", {
						ns: this.namespace,
						section,
						...(revision === undefined ? {} : { expectedRevision: revision }),
					});
					if (envelope.result.ok) {
						this.accept(
							envelope.result.value,
							this.store.getSnapshot().writable,
						);
					} else {
						await this.load();
						throw new Error(
							envelope.result.message ?? "settings bridge replace failed",
						);
					}
				}
			}

			/** ctx.pluginSettings service: bind(ns) -> settingsScope-compatible scope. */
			class PluginSettingsBinder extends Service {
				constructor(ctx) {
					super(ctx, "pluginSettings");
				}
				bind(namespace) {
					return new BridgeScopeController(namespace);
				}
			}

			function createCardController(scope, entry) {
				let saving = false;
				let failed = false;
				const store = createSnapshotStore(projection());
				scope.subscribe(() => publish());
				// 注册后立刻拉取一次桥接描述，否则卡片会一直停在 loading 而不渲染。
				void scope.load();
				function projection() {
					const snapshot = scope.getSnapshot();
					return {
						available: snapshot.status !== "loading",
						exposed: snapshot.status === "ready",
						writable: snapshot.writable,
						value: snapshot.value,
						base: snapshot.base,
						user: snapshot.user,
						revision: snapshot.revision,
						saving,
						failed,
					};
				}
				function publish() {
					store.set(projection());
				}
				return {
					store,
					async save(section) {
						saving = true;
						failed = false;
						publish();
						try {
							await scope.replace(section);
						} catch {
							failed = true;
						}
						saving = false;
						publish();
						return !failed;
					},
					async reload() {
						await scope.load();
					},
					inject() {
						return {
							hooks: { pluginSettingsJson: store },
							namespace: entry.namespace,
							title: entry.title,
							description: entry.description,
							save: (section) => this.save(section),
							reload: () => this.reload(),
						};
					},
				};
			}

			const zh = {
				valueLabel: "JSON 配置（写入该命名空间的 user 层，留空键会被清除）",
				invalidJson: "不是合法 JSON，请检查后重试。",
				notExposed:
					"当前 Harness 未向设置页暴露该命名空间。请确认已安装 dsh-settings-bridge 并在 settings.yaml 的 web_settings_namespaces 中加入它。",
				readOnly: "当前部署的设置只读。",
				save: "保存",
				saving: "保存中…",
				reload: "重新读取",
				saveFailed: "保存未生效（可能是校验失败或修订冲突），已重新读取。",
				inherited: "继承默认：",
			};
			const en = {
				valueLabel:
					"JSON config (writes the namespace user layer; omit a key to inherit default)",
				invalidJson: "Invalid JSON. Fix it and try again.",
				notExposed:
					"This namespace is not exposed to configuration clients. Install dsh-settings-bridge and add it to web_settings_namespaces in settings.yaml.",
				readOnly: "This deployment stores settings read-only.",
				save: "Save",
				saving: "Saving…",
				reload: "Reload",
				saveFailed:
					"Save did not land (validation failed or revision conflict). Reloaded latest.",
				inherited: "Inherited default: ",
			};

			const fieldStyle = {
				width: "100%",
				minHeight: "220px",
				fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
				fontSize: "12px",
				lineHeight: "1.5",
				background: "var(--dsw-alias-bg-layer-1, #fff)",
				color: "var(--dsw-alias-label-primary, #111)",
				border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))",
				borderRadius: "8px",
				padding: "8px 10px",
				resize: "vertical",
				boxSizing: "border-box",
			};

			const buttonStyle = {
				font: "inherit",
				cursor: "pointer",
				borderRadius: "6px",
				padding: "5px 12px",
				fontSize: "13px",
				border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))",
				background: "var(--dsw-alias-button-secondary-fill, transparent)",
				color: "var(--dsw-alias-label-primary, #111)",
			};

			const saveButtonStyle = {
				...buttonStyle,
				border: "none",
				background: "var(--dsw-alias-button-info-fill, #3964fe)",
				color: "#fff",
			};

			function PluginSettingsJsonCard(props) {
				const { t } = props;
				const state = props.usePluginSettingsJson((snapshot) => snapshot);
				const [draft, setDraft] = react.useState(null);
				const [error, setError] = react.useState(null);

				react.useEffect(() => {
					if (draft === null && state.value !== undefined) {
						setDraft(JSON.stringify(state.value, null, 2));
					}
				}, [state.value, draft]);

				if (!state.available) return null;

				const title = props.title ?? props.namespace;
				const description = props.description ?? "";

				if (!state.exposed) {
					return react.createElement(
						"li",
						{
							style: {
								padding: "10px 14px",
								color: "var(--dsw-alias-state-warn-primary, #b45309)",
							},
						},
						react.createElement("div", { style: { fontWeight: 600 } }, title),
						react.createElement(
							"p",
							{ style: { fontSize: "12px", margin: "6px 0 0" } },
							t("notExposed"),
						),
					);
				}

				const save = async () => {
					let parsed;
					try {
						parsed = JSON.parse(draft ?? "{}");
					} catch {
						setError(t("invalidJson"));
						return;
					}
					setError(null);
					const ok = await props.save(parsed);
					if (!ok) setError(t("saveFailed"));
				};

				return react.createElement(
					"li",
					{
						style: {
							padding: "10px 14px",
							display: "flex",
							flexDirection: "column",
							gap: "8px",
						},
					},
					react.createElement("div", { style: { fontWeight: 600 } }, title),
					description
						? react.createElement(
								"p",
								{
									style: {
										fontSize: "12px",
										margin: 0,
										color: "var(--dsw-alias-label-tertiary, #666)",
									},
								},
								description,
							)
						: null,
					!state.writable
						? react.createElement(
								"p",
								{
									style: {
										fontSize: "12px",
										margin: 0,
										color: "var(--dsw-alias-state-warn-primary, #b45309)",
									},
								},
								t("readOnly"),
							)
						: null,
					react.createElement("textarea", {
						style: fieldStyle,
						value: draft ?? "",
						disabled: !state.writable || state.saving,
						onChange: (event) => setDraft(event.target.value),
					}),
					error
						? react.createElement(
								"p",
								{
									style: {
										fontSize: "12px",
										margin: 0,
										color: "var(--dsw-alias-state-error-primary, #dc2626)",
									},
								},
								error,
							)
						: null,
					react.createElement(
						"div",
						{
							style: {
								display: "flex",
								gap: "8px",
								justifyContent: "flex-end",
							},
						},
						react.createElement(
							"button",
							{
								type: "button",
								style: buttonStyle,
								onClick: () => props.reload(),
								disabled: state.saving,
							},
							t("reload"),
						),
						react.createElement(
							"button",
							{
								type: "button",
								style: saveButtonStyle,
								onClick: save,
								disabled: !state.writable || state.saving,
							},
							t(state.saving ? "saving" : "save"),
						),
					),
				);
			}

			/** ctx.pluginSettingsCards service: register JSON settings cards into the official plugin config list. */
			class PluginSettingsCards extends Service {
				constructor(ctx) {
					super(ctx, "pluginSettingsCards");
				}
				registerCard(entry) {
					const binder = this.ctx.get("pluginSettings");
					const scope = binder.bind(entry.namespace);
					const controller = createCardController(scope, entry);
					this.ctx.slots.inject("settings.plugin.item", () =>
						this.ctx.slots.register(
							{
								name: "settings.plugin.item",
								id: entry.id ?? `plugin-settings-${entry.namespace}`,
								order: entry.order ?? 100,
								locale: "dsh-settings-bridge",
								inject: () => controller.inject(),
							},
							PluginSettingsJsonCard,
						),
					);
				}
			}

			const inject = ["slots", "locale"];

			function apply(ctx) {
				ctx.effect(
					() => ctx.locale.register("dsh-settings-bridge", { zh, en }),
					"dsh-settings-bridge: dictionaries",
				);
				new PluginSettingsBinder(ctx);
				new PluginSettingsCards(ctx);
			}

			return {
				name: "dsh-settings-bridge-client",
				inject,
				apply,
			};
		},
	});
})();

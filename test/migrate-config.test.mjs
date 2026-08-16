/**
 * migrate-config 纯函数测试（无第三方依赖，不 spawn 子进程）。
 * 运行：node test/migrate-config.test.mjs
 */
import { migrateText } from "../scripts/migrate-config.mjs";

let failures = 0;
function check(name, cond, extra = "") {
	if (cond) console.log(`  ✅ ${name}`);
	else {
		failures++;
		console.log(`  ❌ ${name} ${extra}`);
	}
}

console.log("== 迁移脚本纯函数测试 ==");

// 1. 正常迁移：qq-notify 全量
{
	const old =
		[
			"- insert:",
			"    - id: qq-notify",
			"      name: dsh-qq-notify",
			"      config:",
			"        targetQq: '10001'",
			"        bridgeUrl: 'http://localhost:3456/send'",
			"        notifyApproval: true",
			"        approvalTimeoutMs: 900000",
			"        decisionsFilePath: 'D:\\qq-bot\\harness-decisions.jsonl'",
		].join("\n") + "\n";
	const newT =
		"---\n- insert:\n    - id: qq-notify\n      name: dsh-qq-notify\n";
	const r = migrateText(old, newT, "dsh-qq-notify");
	check("正常迁移 → ok", r.ok === true);
	check("保留 targetQq", r.text.includes("targetQq: '10001'"), r.text);
	check(
		"保留 bridgeUrl 带引号",
		r.text.includes("bridgeUrl: 'http://localhost:3456/send'"),
		r.text,
	);
	check("布尔无引号", r.text.includes("notifyApproval: true"), r.text);
	check("数字无引号", r.text.includes("approvalTimeoutMs: 900000"), r.text);
	check(
		"Windows 路径保留",
		r.text.includes("'D:\\qq-bot\\harness-decisions.jsonl'"),
		r.text,
	);
}

// 2. 无旧 config（旧 patch 无 config 块）
{
	const old = "- insert:\n    - id: qq-notify\n      name: dsh-qq-notify\n";
	const r = migrateText(old, old, "dsh-qq-notify");
	check("无 config → skipped", r.ok === false && r.skipped);
}

// 3. 目标无对应 name 行
{
	const old =
		'- insert:\n    - id: qq-notify\n      name: dsh-qq-notify\n      config:\n        targetQq: "123"\n';
	const newT = "---\n- insert:\n    - id: other\n      name: dsh-other\n";
	const r = migrateText(old, newT, "dsh-qq-notify");
	check("目标无 name → 仍返回 ok（文本原样）", r.ok === true);
	check("目标无 name → 文本含 dsh-other", r.text.includes("dsh-other"), r.text);
	check("目标无 name → 不注入 config", !r.text.includes("config:"), r.text);
}

// 4. 特殊值：中文/冒号/空/嵌套引号（用白名单内的键）
{
	const old =
		[
			"- insert:",
			"    - id: qq-notify",
			"      name: dsh-qq-notify",
			"      config:",
			"        bridgeUrl: 'http://localhost:3456/send'",
			"        sessionNames: '{sid1: 测试:带冒号}'",
			"        tokenPrefix: ''",
			"        decisionsFilePath: 'it''s a path'",
			"        approvalTimeoutMs: 42",
			"        notifyApproval: false",
			"        monitoredSessions: '[a, b]'",
		].join("\n") + "\n";
	const newT =
		"---\n- insert:\n    - id: qq-notify\n      name: dsh-qq-notify\n";
	const r = migrateText(old, newT, "dsh-qq-notify");
	check("特殊值 → ok", r.ok === true, r.skipped);
	check("中文保留", r.text.includes("测试:带冒号"), r.text);
	check("冒号值保留", r.text.includes("带冒号"), r.text);
	check("空值保留", r.text.includes("tokenPrefix: ''"), r.text);
	check("数字无引号", r.text.includes("approvalTimeoutMs: 42"), r.text);
	check("false 无引号", r.text.includes("notifyApproval: false"), r.text);
	check(
		"数组原样（YAML 数组语法）",
		r.text.includes("monitoredSessions: [a, b]"),
		r.text,
	);
	check(
		"引号转义（YAML 单引号翻倍）",
		r.text.includes("'it''''s a path'"),
		r.text,
	);
}

// 5. 白名单剔除：context-guard 去掉 targetQq/bridgeUrl
{
	const old =
		'- insert:\n    - id: context-guard\n      name: dsh-context-guard\n      config:\n        enabled: true\n        targetQq: "10001"\n        bridgeUrl: "http://x"\n';
	const newT =
		"---\n- insert:\n    - id: context-guard\n      name: dsh-context-guard\n";
	const r = migrateText(old, newT, "dsh-context-guard");
	check("白名单 → ok", r.ok === true);
	check("保留 enabled", r.text.includes("enabled: true"), r.text);
	check("剔除 targetQq", !r.text.includes("targetQq"), r.text);
	check("剔除 bridgeUrl", !r.text.includes("bridgeUrl"), r.text);
	check(
		"dropped 报告",
		r.dropped.includes("targetQq") && r.dropped.includes("bridgeUrl"),
		r.dropped.join(","),
	);
}

// 6. 全被剔除 → skipped
{
	const old =
		'- insert:\n    - id: context-guard\n      name: dsh-context-guard\n      config:\n        targetQq: "1"\n';
	const newT =
		"---\n- insert:\n    - id: context-guard\n      name: dsh-context-guard\n";
	const r = migrateText(old, newT, "dsh-context-guard");
	check("全剔除 → skipped", r.ok === false && r.skipped.includes("无可迁移键"));
}

console.log("");
if (failures) {
	console.log(`❌ ${failures} 项失败`);
	process.exit(1);
}
console.log("✅ 迁移脚本纯函数测试全部通过");

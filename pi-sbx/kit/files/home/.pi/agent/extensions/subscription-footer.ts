import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const SUBSCRIPTION_PROVIDERS = new Set(["openai-codex", "kimi-coding"]);

function formatTokens(count: number): string {
	if (count < 1_000) return String(count);
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function formatCwd(cwd: string): string {
	const home = os.homedir();
	const relative = path.relative(home, cwd);
	if (relative === "") return "~";
	if (!relative.startsWith("..") && !path.isAbsolute(relative)) return `~${path.sep}${relative}`;
	return cwd;
}

function sanitizeStatus(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function installFooter(ctx: ExtensionContext, selectedModel: Model<any> | undefined): void {
	if (!selectedModel || !SUBSCRIPTION_PROVIDERS.has(selectedModel.provider)) {
		ctx.ui.setFooter(undefined);
		return;
	}

	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		return {
			invalidate() {},
			dispose: unsubscribe,
			render(width: number): string[] {
				const usage = ctx.getContextUsage();
				const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
				const contextPercent = usage?.percent;
				const contextText = `${contextPercent === null || contextPercent === undefined ? "?" : contextPercent.toFixed(1) + "%"}/${formatTokens(contextWindow)}`;
				const coloredContext = contextPercent !== null && contextPercent !== undefined && contextPercent > 90
					? theme.fg("error", contextText)
					: contextPercent !== null && contextPercent !== undefined && contextPercent > 70
						? theme.fg("warning", contextText)
						: contextText;

				let cwd = formatCwd(ctx.cwd);
				const branch = footerData.getGitBranch();
				if (branch) cwd += ` (${branch})`;

				const model = ctx.model ?? selectedModel;
				const thinking = model.reasoning ? ` • ${ctx.thinkingLevel ?? "off"}` : "";
				const right = `${model.id}${thinking}`;
				const leftWidth = visibleWidth(contextText);
				const rightWidth = visibleWidth(right);
				const statsLine = leftWidth + 2 + rightWidth <= width
					? coloredContext + " ".repeat(width - leftWidth - rightWidth) + right
					: coloredContext;

				const lines = [
					truncateToWidth(theme.fg("dim", cwd), width, theme.fg("dim", "...")),
					theme.fg("dim", statsLine),
				];
				const statuses = [...footerData.getExtensionStatuses().entries()]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => sanitizeStatus(text));
				if (statuses.length > 0) {
					lines.push(truncateToWidth(statuses.join(" "), width, theme.fg("dim", "...")));
				}
				return lines;
			},
		};
	});
}

export default function subscriptionFooter(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => installFooter(ctx, ctx.model));
	pi.on("model_select", (event, ctx) => installFooter(ctx, event.model));
}

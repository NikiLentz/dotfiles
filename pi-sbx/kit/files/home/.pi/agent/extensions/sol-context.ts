import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.6-sol";
const SHORT_CONTEXT = 272_000;
const LONG_CONTEXT = 1_000_000;
const STATE_ENTRY = "sol-context-window";

interface SolContextState {
	longContext: boolean;
}

export default function solContext(pi: ExtensionAPI): void {
	let longContext = false;

	pi.registerFlag("sol-1m", {
		description: "Use GPT-5.6 Sol's 1M context window for this session",
		type: "boolean",
		default: false,
	});

	function isSol(model: Model<any> | undefined): boolean {
		return model?.provider === PROVIDER && model.id === MODEL_ID;
	}

	function apply(ctx: ExtensionContext): void {
		const model = ctx.modelRegistry.find(PROVIDER, MODEL_ID);
		if (model) model.contextWindow = longContext ? LONG_CONTEXT : SHORT_CONTEXT;
		if (isSol(ctx.model)) ctx.model!.contextWindow = longContext ? LONG_CONTEXT : SHORT_CONTEXT;
	}

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(
			"sol-context",
			longContext && isSol(ctx.model) ? ctx.ui.theme.fg("accent", "sol 1m") : undefined,
		);
	}

	function persist(): void {
		pi.appendEntry(STATE_ENTRY, { longContext } satisfies SolContextState);
	}

	pi.registerCommand("sol-context", {
		description: "Select Sol's context window (usage: /sol-context [272k|1m|status])",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "status" || action === "") {
				ctx.ui.notify(
					`GPT-5.6 Sol context is ${longContext ? "1M" : "272K"} tokens${isSol(ctx.model) ? "" : " (applies when Sol is selected)"}.`,
					"info",
				);
				return;
			}
			if (!["272k", "short", "1m", "long"].includes(action)) {
				ctx.ui.notify("Usage: /sol-context [272k|1m|status]", "warning");
				return;
			}
			longContext = ["1m", "long"].includes(action);
			apply(ctx);
			updateStatus(ctx);
			persist();
			ctx.ui.notify(
				`GPT-5.6 Sol context set to ${longContext ? "1M" : "272K"} tokens.`,
				longContext ? "warning" : "info",
			);
		},
	});

	pi.on("model_select", (event, ctx) => {
		if (isSol(event.model)) event.model.contextWindow = longContext ? LONG_CONTEXT : SHORT_CONTEXT;
		updateStatus(ctx);
	});

	pi.on("session_start", (_event, ctx) => {
		const state = ctx.sessionManager
			.getBranch()
			.filter((entry) => entry.type === "custom" && entry.customType === STATE_ENTRY)
			.at(-1)?.data as SolContextState | undefined;
		longContext = state?.longContext ?? false;
		if (pi.getFlag("sol-1m") === true) longContext = true;
		apply(ctx);
		updateStatus(ctx);
	});
}

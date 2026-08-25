import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "graphify_query"]);
const NON_WRITING_SUBAGENTS = new Set(["scout", "planner", "debugger", "test-runner", "reviewer"]);
const STATE_ENTRY = "agent-operating-mode";
const LEGACY_PLAN_STATE_ENTRY = "strict-plan-mode";

type AgentMode = "auto" | "plan" | "tutor" | "ask";

const MODE_ORDER: AgentMode[] = ["auto", "plan", "tutor", "ask"];

interface ModeState {
	mode: AgentMode;
	toolsBeforeMode?: string[];
}

interface LegacyPlanModeState {
	enabled: boolean;
	toolsBeforePlanMode?: string[];
}

const PLAN_PROMPT = `[STRICT PLAN MODE]
You are in a read-only planning mode. Inspect the project with read, grep, find, ls, and graphify_query when an existing knowledge graph is available. You may delegate isolated research or review to scout, planner, debugger, test-runner, and reviewer subagents, but never to worker or unknown/project-defined agents. Do not edit files, execute shell commands yourself, or make other side effects. Ask clarifying questions when needed. Return a concrete implementation plan with numbered steps, exact file paths, validation steps, and notable risks.`;

const TUTOR_PROMPT = `[TUTOR MODE — READ-ONLY MENTOR]
Act as a programming tutor, not an implementer. The user will write the solution; you teach, inspect, review, and give progressively more specific pointers.

Hard constraints:
- Use read, grep, find, ls, and graphify_query directly. You may delegate research or review to scout, planner, debugger, test-runner, and reviewer, but never worker or unknown/project-defined agents. Never edit files, execute shell commands yourself, or make side effects.
- Do not provide a complete patch, drop-in implementation, or finished solution unless the user explicitly asks to leave tutor mode.
- Prefer questions, conceptual explanations, pseudocode, signatures, and small illustrative snippets over copy-paste-ready code.

For a new implementation task, produce a tutorial-style guide:
1. State the learning goal and expected behavior.
2. Orient the user to the relevant architecture, files, types, and data flow.
3. Break the work into small ordered stages. For each stage explain why it exists, where to work, what to implement, and a concrete checkpoint proving it works.
4. Highlight likely mistakes, edge cases, and tests to consider.
5. End with the next stage the user should implement and ask them to return with their changes or questions.

When the user returns after implementing work:
- Inspect the current files and review what they wrote against the guide.
- Start with what is correct and why.
- Identify issues in priority order with exact file paths and line ranges where possible.
- Give pointers using an escalation ladder: conceptual hint first, then a targeted suggestion, then a minimal example only if needed.
- Do not silently solve the issue for them or edit their code.
- Recommend focused verification steps the user can run, then clearly state the next action.

Adapt depth to the user's apparent experience and explain the reasoning behind recommendations.`;

const ASK_PROMPT = `[ASK MODE — READ-ONLY CONVERSATION]
Act as a conversational coding assistant for questions, explanations, exploration, and design discussion. This is not plan mode: do not force answers into implementation plans, numbered execution steps, or task checklists unless the user explicitly asks for that format.

You may inspect the project with read, grep, find, ls, and graphify_query when evidence is useful, and may delegate research or review to scout, planner, debugger, test-runner, and reviewer. Never invoke worker or unknown/project-defined agents, edit files, execute shell commands yourself, or make side effects. Answer directly and naturally, explain relevant trade-offs, and use examples or small snippets when helpful. You may suggest possible changes, but do not apply them. If the user asks you to implement something, explain that ask mode is read-only and offer discussion or suggest switching to auto mode.`;

function isAgentMode(value: unknown): value is AgentMode {
	return value === "auto" || value === "plan" || value === "tutor" || value === "ask";
}

function normalizeToolList(value: unknown, available: Set<string>): string[] | undefined {
	if (!Array.isArray(value) || !value.every((name) => typeof name === "string")) return undefined;
	const tools = [...new Set(value as string[])];
	return tools.every((name) => available.has(name)) ? tools : undefined;
}

function sameTools(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((name) => right.includes(name));
}

function requestedSubagentNames(input: unknown): string[] | null {
	if (typeof input !== "object" || input === null) return null;
	const params = input as {
		agent?: unknown;
		tasks?: unknown;
		chain?: unknown;
		agentScope?: unknown;
		confirmProjectAgents?: unknown;
	};
	const names: string[] = [];
	let malformed = false;

	if (params.agent !== undefined) {
		if (typeof params.agent === "string") names.push(params.agent);
		else malformed = true;
	}
	for (const group of [params.tasks, params.chain]) {
		if (group === undefined) continue;
		if (!Array.isArray(group)) {
			malformed = true;
			continue;
		}
		for (const item of group) {
			if (typeof item === "object" && item !== null && typeof (item as { agent?: unknown }).agent === "string") {
				names.push((item as { agent: string }).agent);
			} else {
				malformed = true;
			}
		}
	}

	return !malformed && names.length > 0 ? names : null;
}

export default function operatingModes(pi: ExtensionAPI): void {
	let mode: AgentMode = "auto";
	let toolsBeforeMode: string[] | undefined;

	pi.registerFlag("plan", {
		description: "Start in strict read-only plan mode",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("tutor", {
		description: "Start in read-only tutor mode",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("ask", {
		description: "Start in read-only conversational ask mode",
		type: "boolean",
		default: false,
	});

	function setStatus(ctx: ExtensionContext): void {
		const text = mode === "plan"
			? ctx.ui.theme.fg("warning", "mode: plan (read-only)")
			: mode === "tutor"
				? ctx.ui.theme.fg("accent", "mode: tutor (you implement)")
				: mode === "ask"
					? ctx.ui.theme.fg("success", "mode: ask (read-only chat)")
					: ctx.ui.theme.fg("dim", "mode: auto");
		ctx.ui.setStatus("agent-mode", text);
	}

	function allConfiguredTools(): string[] {
		return pi.getAllTools().map((tool) => tool.name);
	}

	function restrictedTools(tools: string[]): string[] {
		return tools.filter((name) => READ_ONLY_TOOLS.has(name) || name === "subagent");
	}

	function looksRestricted(tools: string[]): boolean {
		return tools.every((name) => READ_ONLY_TOOLS.has(name) || name === "subagent");
	}

	function applyReadOnlyTools(): void {
		if (toolsBeforeMode === undefined) toolsBeforeMode = pi.getActiveTools();
		pi.setActiveTools(restrictedTools(toolsBeforeMode));
	}

	function restoreTools(useConfiguredFallback: boolean): void {
		const activeTools = pi.getActiveTools();
		const restoredTools = toolsBeforeMode ?? (useConfiguredFallback && looksRestricted(activeTools)
			? allConfiguredTools()
			: activeTools);
		pi.setActiveTools(restoredTools);
		toolsBeforeMode = [...restoredTools];
	}

	function persist(): void {
		pi.appendEntry(STATE_ENTRY, { mode, toolsBeforeMode } satisfies ModeState);
	}

	function describeMode(value: AgentMode): string {
		if (value === "plan") return "plan — strict read-only planning";
		if (value === "tutor") return "tutor — you implement; Pi teaches and reviews";
		if (value === "ask") return "ask — read-only conversation and exploration";
		return "auto — normal implementation mode";
	}

	function setMode(next: AgentMode, ctx: ExtensionContext): void {
		if (next === mode) {
			if (mode === "auto") restoreTools(true);
			else applyReadOnlyTools();
			setStatus(ctx);
			persist();
			ctx.ui.notify(`Already in ${describeMode(mode)}.`, "info");
			return;
		}

		if (next === "auto") {
			mode = "auto";
			restoreTools(true);
		} else {
			if (mode === "auto") toolsBeforeMode = pi.getActiveTools();
			mode = next;
			applyReadOnlyTools();
		}
		ctx.ui.notify(`Mode: ${describeMode(mode)}.`, "info");
		setStatus(ctx);
		persist();
	}

	function registerModeCommand(command: Exclude<AgentMode, "auto">): void {
		const labels: Record<Exclude<AgentMode, "auto">, string> = {
			plan: "strict read-only plan",
			tutor: "read-only tutor",
			ask: "read-only conversational ask",
		};
		pi.registerCommand(command, {
			description: `Switch between auto and ${labels[command]} mode (usage: /${command} [auto|${command}|status])`,
			handler: async (args, ctx) => {
				const action = args.trim().toLowerCase();
				if (action === "status") {
					ctx.ui.notify(`Current mode: ${describeMode(mode)}.`, "info");
					return;
				}

				const enabledAliases = [command, "on"];
				if (action && action !== "auto" && action !== "off" && !enabledAliases.includes(action)) {
					ctx.ui.notify(`Usage: /${command} [auto|${command}|status]`, "warning");
					return;
				}

				const next = action === "auto" || action === "off"
					? "auto"
					: action === command || action === "on"
						? command
						: mode === command
							? "auto"
							: command;
				setMode(next, ctx);
			},
		});
	}

	registerModeCommand("plan");
	registerModeCommand("tutor");
	registerModeCommand("ask");

	pi.registerCommand("mode", {
		description: "Select an operating mode (usage: /mode [auto|plan|tutor|ask|next|status])",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (!action || action === "status") {
				ctx.ui.notify(`Current mode: ${describeMode(mode)}. Available: ${MODE_ORDER.join(", ")}.`, "info");
				return;
			}
			if (action === "next") {
				const index = MODE_ORDER.indexOf(mode);
				setMode(MODE_ORDER[(index + 1) % MODE_ORDER.length], ctx);
				return;
			}
			if (!isAgentMode(action)) {
				ctx.ui.notify("Usage: /mode [auto|plan|tutor|ask|next|status]", "warning");
				return;
			}
			setMode(action, ctx);
		},
	});

	pi.registerShortcut("shift+tab", {
		description: "Cycle operating mode: auto, plan, tutor, ask",
		handler: async (ctx) => {
			const index = MODE_ORDER.indexOf(mode);
			setMode(MODE_ORDER[(index + 1) % MODE_ORDER.length], ctx);
		},
	});

	// Active-tool filtering hides mutation-capable tools, while this gate blocks
	// stale/dynamic calls and prevents restricted modes from delegating to worker
	// or repo-controlled agents that could write code in a separate process.
	pi.on("tool_call", (event) => {
		if (mode === "auto" || READ_ONLY_TOOLS.has(event.toolName)) return;
		if (event.toolName === "subagent") {
			const names = requestedSubagentNames(event.input);
			if (names && names.every((name) => NON_WRITING_SUBAGENTS.has(name))) {
				const input = event.input as {
					agentScope?: string;
					confirmProjectAgents?: boolean;
					restrictedMode?: boolean;
				};
				input.agentScope = "user";
				input.confirmProjectAgents = false;
				input.restrictedMode = true;
				return;
			}
			return {
				block: true,
				reason: `${mode} mode permits only non-writing subagents: ${[...NON_WRITING_SUBAGENTS].join(", ")}.`,
				terminate: true,
			};
		}
		return {
			block: true,
			reason: `${mode[0].toUpperCase()}${mode.slice(1)} mode is read-only; tool ${event.toolName} is disabled. Use /mode auto before making changes.`,
			terminate: true,
		};
	});

	pi.on("before_agent_start", (event) => {
		if (mode === "auto") return;
		const modePrompt = mode === "plan" ? PLAN_PROMPT : mode === "tutor" ? TUTOR_PROMPT : ASK_PROMPT;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${modePrompt}`,
		};
	});

	pi.on("session_start", (event, ctx) => {
		const branch = ctx.sessionManager.getBranch();
		const availableTools = new Set(allConfiguredTools());
		const stateEntries = branch
			.filter((entry) => entry.type === "custom" && entry.customType === STATE_ENTRY)
			.map((entry) => entry.data as ModeState);
		const state = stateEntries.at(-1);
		const legacyState = branch
			.filter((entry) => entry.type === "custom" && entry.customType === LEGACY_PLAN_STATE_ENTRY)
			.at(-1)?.data as LegacyPlanModeState | undefined;

		mode = state && isAgentMode(state.mode)
			? state.mode
			: legacyState?.enabled
				? "plan"
				: "auto";
		toolsBeforeMode = normalizeToolList(state?.toolsBeforeMode, availableTools);
		if (toolsBeforeMode === undefined) {
			for (const candidate of [...stateEntries].reverse()) {
				toolsBeforeMode = normalizeToolList(candidate?.toolsBeforeMode, availableTools);
				if (toolsBeforeMode !== undefined) break;
			}
		}
		if (toolsBeforeMode === undefined) {
			toolsBeforeMode = normalizeToolList(legacyState?.toolsBeforePlanMode, availableTools);
		}

		const flagMode = event.reason === "startup" && pi.getFlag("ask") === true
			? "ask"
			: event.reason === "startup" && pi.getFlag("tutor") === true
				? "tutor"
				: event.reason === "startup" && pi.getFlag("plan") === true
					? "plan"
					: undefined;
		if (flagMode !== undefined) {
			mode = flagMode;
			toolsBeforeMode = pi.getActiveTools();
		}

		const activeTools = pi.getActiveTools();
		if (mode === "auto") {
			if (toolsBeforeMode !== undefined) {
				const restrictedBaseline = restrictedTools(toolsBeforeMode);
				const staleRestriction = looksRestricted(activeTools)
					&& sameTools(activeTools, restrictedBaseline);
				if (sameTools(activeTools, toolsBeforeMode) || staleRestriction) restoreTools(false);
				else toolsBeforeMode = activeTools;
			} else {
				const needsRecovery = state !== undefined && looksRestricted(activeTools);
				restoreTools(needsRecovery);
			}
		} else {
			if (toolsBeforeMode === undefined) {
				toolsBeforeMode = state !== undefined && looksRestricted(activeTools)
					? allConfiguredTools()
					: activeTools;
			}
			applyReadOnlyTools();
		}
		if (flagMode !== undefined) persist();
		setStatus(ctx);
	});

	pi.on("session_shutdown", () => {
		if (mode !== "auto" && toolsBeforeMode !== undefined) pi.setActiveTools(toolsBeforeMode);
	});
}

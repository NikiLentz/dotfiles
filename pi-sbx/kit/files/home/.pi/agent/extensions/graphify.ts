import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const GRAPH_RELATIVE_PATH = path.join("graphify-out", "graph.json");

type GraphifyAction = "status" | "query" | "explain" | "path";

function findGraphRoot(cwd: string): string | null {
	let current = path.resolve(cwd);
	while (true) {
		if (fs.existsSync(path.join(current, GRAPH_RELATIVE_PATH))) return current;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function graphStatus(cwd: string): string {
	const root = findGraphRoot(cwd);
	if (!root) {
		return "No Graphify graph found. Run /graphify . in auto mode to build one for this project.";
	}
	const graphPath = path.join(root, GRAPH_RELATIVE_PATH);
	const reportPath = path.join(root, "graphify-out", "GRAPH_REPORT.md");
	const stat = fs.statSync(graphPath);
	return [
		`Graphify graph: ${graphPath}`,
		`Size: ${(stat.size / (1024 * 1024)).toFixed(1)} MiB`,
		`Updated: ${stat.mtime.toISOString()}`,
		`Architecture report: ${fs.existsSync(reportPath) ? reportPath : "not generated"}`,
	].join("\n");
}

export default function graphifyIntegration(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "graphify_query",
		label: "Graphify Query",
		description: `Query an existing project knowledge graph without modifying source code. Use for architecture, dependencies, call flow, impact analysis, and relationships in larger projects before broad grep or many file reads.

Actions:
- status: report whether graphify-out/graph.json exists
- query: return a scoped subgraph for a natural-language question
- explain: explain one graph node or concept
- path: find the shortest graph path between two concepts

Graph results are navigation context, not authority. Verify important claims against current source files before acting.`,
		promptSnippet: "Query an existing project knowledge graph for architecture and code relationships",
		promptGuidelines: [
			"Use graphify_query before broad searches when graphify-out/graph.json exists and the task concerns architecture, dependencies, call flow, or change impact.",
			"Verify important graphify_query findings against current source before editing because a graph can be stale.",
		],
		parameters: Type.Object({
			action: StringEnum(["status", "query", "explain", "path"] as const, {
				description: "Read-only graph operation.",
			}),
			query: Type.Optional(Type.String({ description: "Natural-language question for query, or concept for explain." })),
			source: Type.Optional(Type.String({ description: "Starting concept for path." })),
			target: Type.Optional(Type.String({ description: "Destination concept for path." })),
			budget: Type.Optional(Type.Number({ minimum: 100, maximum: 10000, description: "Maximum query answer budget." })),
		}, { additionalProperties: false }),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const action = params.action as GraphifyAction;
			if (action === "status") {
				const text = graphStatus(ctx.cwd);
				return { content: [{ type: "text", text }], details: { action, text } };
			}

			const root = findGraphRoot(ctx.cwd);
			if (!root) throw new Error("No graphify-out/graph.json found. Run /graphify . in auto mode first.");

			const args = ["-m", "graphify", action];
			if (action === "query") {
				if (!params.query?.trim()) throw new Error("query is required for action=query");
				args.push(params.query.trim());
				if (params.budget !== undefined) args.push("--budget", String(Math.round(params.budget)));
			} else if (action === "explain") {
				if (!params.query?.trim()) throw new Error("query is required for action=explain");
				args.push(params.query.trim());
			} else {
				if (!params.source?.trim() || !params.target?.trim()) {
					throw new Error("source and target are required for action=path");
				}
				args.push(params.source.trim(), params.target.trim());
			}

			const result = await pi.exec("python3", args, { signal, timeout: 120_000, cwd: root });
			if (result.code !== 0) {
				throw new Error((result.stderr || result.stdout || `graphify exited ${result.code}`).trim());
			}
			const raw = result.stdout.trim() || "(no graph results)";
			const truncated = truncateHead(raw, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
			const text = truncated.truncated
				? `${truncated.content}\n\n[Graphify output truncated to ${DEFAULT_MAX_LINES} lines / ${DEFAULT_MAX_BYTES} bytes.]`
				: truncated.content;
			return {
				content: [{ type: "text", text }],
				details: { action, root, truncated: truncated.truncated },
			};
		},
	});


	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setStatus(
			"graphify",
			findGraphRoot(ctx.cwd) ? ctx.ui.theme.fg("dim", "graphify: indexed") : undefined,
		);
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (!findGraphRoot(ctx.cwd)) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n[GRAPHIFY]\nThis project has graphify-out/graph.json. For broad architecture, dependency, call-flow, or impact questions, prefer graphify_query before wide grep or reading many files. Treat graph output as a navigation aid and verify important claims against current source.`,
		};
	});
}

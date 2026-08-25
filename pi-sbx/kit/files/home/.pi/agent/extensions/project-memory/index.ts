import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import hermesMemory from "pi-hermes-memory";
import { detectProject } from "pi-hermes-memory/src/project.js";

const PROJECT_STORAGE_RELATIVE = path.join(".pi", "hermes-memory");
const PROJECTS_MEMORY_DIR = "projects-memory";
const BLOCKED_COMMANDS = new Set(["memory-consolidate", "memory-interview", "memory-skills"]);
const MEMORY_MUTATION_TOOLS = new Set(["memory_add", "memory_replace", "memory_remove"]);

type MutableToolInput = Record<string, unknown>;

function findWorkspaceRoot(cwd: string): string {
	let current = path.resolve(cwd);
	while (true) {
		if (fs.existsSync(path.join(current, ".git"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return path.resolve(cwd);
		current = parent;
	}
}

function mergeDirectory(source: string, target: string): void {
	fs.mkdirSync(target, { recursive: true });
	for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
		const sourcePath = path.join(source, entry.name);
		const targetPath = path.join(target, entry.name);
		if (!fs.existsSync(targetPath)) {
			fs.cpSync(sourcePath, targetPath, { recursive: true, errorOnExist: true });
			continue;
		}
		if (entry.isDirectory() && fs.statSync(targetPath).isDirectory()) {
			mergeDirectory(sourcePath, targetPath);
			continue;
		}
		const migratedPath = `${targetPath}.sandbox-migration-${Date.now()}`;
		fs.cpSync(sourcePath, migratedPath, { recursive: true, errorOnExist: true });
	}
	fs.rmSync(source, { recursive: true, force: true });
}

function ensureDirectoryLink(linkPath: string, targetPath: string): void {
	fs.mkdirSync(path.dirname(linkPath), { recursive: true });
	fs.mkdirSync(targetPath, { recursive: true });

	try {
		const stat = fs.lstatSync(linkPath);
		if (stat.isSymbolicLink()) {
			const currentTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
			if (currentTarget === path.resolve(targetPath)) return;
			fs.unlinkSync(linkPath);
		} else if (stat.isDirectory()) {
			mergeDirectory(linkPath, targetPath);
		} else {
			throw new Error(`Refusing to replace non-directory memory path: ${linkPath}`);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	fs.symlinkSync(targetPath, linkPath, "dir");
}

function resolveCommonGitDir(workspaceRoot: string): string | null {
	const dotGit = path.join(workspaceRoot, ".git");
	try {
		const stat = fs.statSync(dotGit);
		if (stat.isDirectory()) return dotGit;
		if (!stat.isFile()) return null;

		const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
		if (!match) return null;
		const gitDir = path.resolve(workspaceRoot, match[1].trim());
		const commonDirFile = path.join(gitDir, "commondir");
		return fs.existsSync(commonDirFile)
			? path.resolve(gitDir, fs.readFileSync(commonDirFile, "utf8").trim())
			: gitDir;
	} catch {
		return null;
	}
}

function excludePrivateMemoryFromGit(workspaceRoot: string): void {
	const gitDir = resolveCommonGitDir(workspaceRoot);
	if (!gitDir) return;

	const excludePath = path.join(gitDir, "info", "exclude");
	const rule = "/.pi/hermes-memory/";
	fs.mkdirSync(path.dirname(excludePath), { recursive: true });
	const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
	if (existing.split(/\r?\n/).includes(rule)) return;
	fs.appendFileSync(excludePath, `${existing && !existing.endsWith("\n") ? "\n" : ""}${rule}\n`, "utf8");
}

function projectOnlyApi(pi: ExtensionAPI): ExtensionAPI {
	return new Proxy(pi, {
		get(target, property, receiver) {
			if (property === "registerCommand") {
				return (name: string, options: unknown) => {
					if (!BLOCKED_COMMANDS.has(name)) {
						target.registerCommand(name, options as Parameters<ExtensionAPI["registerCommand"]>[1]);
					}
				};
			}

			const value = Reflect.get(target, property, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

export default function projectMemory(pi: ExtensionAPI): void {
	const workspaceRoot = findWorkspaceRoot(process.cwd());
	const storageRoot = path.join(workspaceRoot, PROJECT_STORAGE_RELATIVE);
	const agentRoot = getAgentDir();

	fs.mkdirSync(storageRoot, { recursive: true });
	excludePrivateMemoryFromGit(workspaceRoot);

	// Upstream keeps its SQLite index and global stores together. The global
	// stores remain empty in project-only mode, but redirecting the whole root
	// keeps the useful session/memory search index durable across sandbox rebuilds.
	ensureDirectoryLink(
		path.join(agentRoot, "pi-hermes-memory"),
		path.join(storageRoot, "runtime"),
	);

	// Link the projects root rather than an individual project directory.
	// Upstream deliberately rejects symlinked project directories when syncing
	// Markdown into SQLite, but safely accepts ordinary directories reached
	// through a symlinked parent whose canonical root remains contained.
	ensureDirectoryLink(
		path.join(agentRoot, PROJECTS_MEMORY_DIR),
		path.join(storageRoot, "projects"),
	);
	const project = detectProject(PROJECTS_MEMORY_DIR, process.cwd());
	if (!project.name || !project.memoryDir) {
		throw new Error("pi-hermes-memory project-only mode requires a project working directory");
	}
	fs.mkdirSync(project.memoryDir, { recursive: true });

	// Enforce project-only scope even if the model follows an upstream tool
	// description that still mentions global/user/failure targets.
	pi.on("tool_call", (event) => {
		const input = event.input as MutableToolInput;
		if (MEMORY_MUTATION_TOOLS.has(event.toolName)) {
			input.target = "project";
			delete input.category;
			delete input.failure_reason;
			return;
		}
		if (event.toolName === "memory_search") {
			input.project = project.name;
			delete input.target;
			delete input.category;
			return;
		}
		if (event.toolName === "skill_manage") {
			if (input.action === "create") input.scope = "project";
			if (typeof input.skill_id === "string" && input.skill_id.startsWith("global:")) {
				return {
					block: true,
					reason: "Global skills are disabled; use a project-scoped skill.",
				};
			}
		}
	});

	hermesMemory(projectOnlyApi(pi));
}

import { readFileSync } from "node:fs";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type CheckGroup = "identity" | "infrastructure";

type VerificationCheck = {
	id: string;
	group: CheckGroup;
	label: string;
	passed: boolean;
	evidence: string;
};

type VerificationResult = {
	verified: boolean;
	checks: VerificationCheck[];
};

function readRuntimeFile(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

function mountFsType(line: string): string | undefined {
	const separator = line.indexOf(" - ");
	if (separator === -1) return undefined;
	return line.slice(separator + 3).split(" ")[0];
}

function verifySandbox(): VerificationResult {
	const sandboxId = process.env.SANDBOX_VM_ID;
	const hostname = os.hostname();
	const cgroup = readRuntimeFile("/proc/1/cgroup");
	const mountinfo = readRuntimeFile("/proc/self/mountinfo");
	const procVersion = readRuntimeFile("/proc/version");
	const pidOneName = readRuntimeFile("/proc/1/comm")?.trim();
	const mountLines = mountinfo?.split("\n").filter(Boolean) ?? [];
	const rootMount = mountLines.find((line) => {
		const separator = line.indexOf(" - ");
		return separator !== -1 && line.slice(0, separator).split(" ")[4] === "/";
	});
	const dockerCgroupId = cgroup?.match(/(?:^|\/)docker(?:\/|-)([0-9a-f]{64})(?:\.scope)?(?=$|\/)/m)?.[1];
	const matchingBundleMount = dockerCgroupId !== undefined
		&& (mountinfo?.includes(`/run/bundles/${dockerCgroupId}/`) ?? false);
	const kernelMarker = procVersion?.toLowerCase().includes("buildkitsandbox") ?? false;
	const tiniPidOne = pidOneName === "tini";

	const checks: VerificationCheck[] = [
		{
			id: "sandbox-id-prefix",
			group: "identity",
			label: "SANDBOX_VM_ID has the pi- prefix",
			passed: typeof sandboxId === "string" && sandboxId.startsWith("pi-") && sandboxId.length > 3,
			evidence: typeof sandboxId === "string" && sandboxId.startsWith("pi-") && sandboxId.length > 3
				? "required sandbox identity prefix is present"
				: "sandbox identity is missing or lacks the required prefix",
		},
		{
			id: "sandbox-id-hostname",
			group: "identity",
			label: "SANDBOX_VM_ID matches the hostname",
			passed: typeof sandboxId === "string" && sandboxId === hostname,
			evidence: typeof sandboxId === "string" && sandboxId === hostname
				? "sandbox identity and kernel hostname match"
				: "sandbox identity and kernel hostname do not match",
		},
		{
			id: "docker-cgroup",
			group: "infrastructure",
			label: "PID 1 has a Docker container cgroup",
			passed: dockerCgroupId !== undefined,
			evidence: cgroup === undefined
				? "PID 1 cgroup data is unreadable"
				: dockerCgroupId !== undefined
					? "Docker-scoped 64-hex container identity is present"
					: "Docker-scoped 64-hex container identity is absent",
		},
		{
			id: "root-overlay",
			group: "infrastructure",
			label: "The root mount uses overlay",
			passed: rootMount !== undefined && mountFsType(rootMount) === "overlay",
			evidence: mountinfo === undefined
				? "mountinfo is unreadable"
				: rootMount === undefined
					? "the root mount entry is absent"
					: mountFsType(rootMount) === "overlay"
						? "the root filesystem type is overlay"
						: "the root filesystem type is not overlay",
		},
		{
			id: "virtiofs-mount",
			group: "infrastructure",
			label: "Mountinfo contains virtiofs",
			passed: mountLines.some((line) => mountFsType(line) === "virtiofs"),
			evidence: mountinfo === undefined
				? "mountinfo is unreadable"
				: mountLines.some((line) => mountFsType(line) === "virtiofs")
					? "at least one virtiofs mount is present"
					: "no virtiofs mount is present",
		},
		{
			id: "run-bundles-mount",
			group: "infrastructure",
			label: "Mountinfo contains the matching /run/bundles path",
			passed: matchingBundleMount,
			evidence: mountinfo === undefined
				? "mountinfo is unreadable"
				: dockerCgroupId === undefined
					? "the Docker cgroup identity is unavailable for bundle matching"
					: matchingBundleMount
						? "the matching sbx bundle mount path is present"
						: "the matching sbx bundle mount path is absent",
		},
		{
			id: "kernel-marker",
			group: "infrastructure",
			label: "The kernel has the buildkitsandbox marker",
			passed: kernelMarker,
			evidence: kernelMarker
				? "the buildkitsandbox kernel marker is present"
				: "the buildkitsandbox kernel marker is absent",
		},
		{
			id: "init-marker",
			group: "infrastructure",
			label: "tini is PID 1",
			passed: tiniPidOne,
			evidence: tiniPidOne ? "tini is PID 1" : "tini is not PID 1",
		},
	];
	const identityVerified = checks.filter((check) => check.group === "identity").every((check) => check.passed);
	const infrastructureVerified = checks.filter((check) => check.group === "infrastructure").every((check) => check.passed);
	return { verified: identityVerified && infrastructureVerified, checks };
}

function updateStatus(ctx: ExtensionContext, result: VerificationResult): void {
	ctx.ui.setStatus(
		"sbx-runtime",
		result.verified
			? ctx.ui.theme.fg("success", "sbx: active")
			: ctx.ui.theme.fg("error", "sbx: unverified"),
	);
}

function formatEvidence(result: VerificationResult): string {
	const lines = result.checks.map((check) => `${check.passed ? "PASS" : "FAIL"} ${check.label}: ${check.evidence}`);
	return [`Docker sbx verification: ${result.verified ? "PASS" : "FAIL"}`, ...lines].join("\n");
}

export default function sbxStatus(pi: ExtensionAPI): void {
	let startupWarningIssued = false;

	pi.registerCommand("sbx-status", {
		description: "Show Docker sbx runtime verification evidence",
		handler: async (_args, ctx) => {
			const result = verifySandbox();
			updateStatus(ctx, result);
			ctx.ui.notify(formatEvidence(result), result.verified ? "info" : "error");
		},
	});

	pi.on("session_start", (event, ctx) => {
		const result = verifySandbox();
		updateStatus(ctx, result);
		if (event.reason === "startup" && !result.verified && !startupWarningIssued) {
			startupWarningIssued = true;
			const failedChecks = result.checks.filter((check) => !check.passed).map((check) => check.label);
			ctx.ui.notify(`Docker sbx runtime is unverified. Failed checks: ${failedChecks.join("; ")}`, "error");
		}
	});
}

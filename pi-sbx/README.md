# pi-sbx — sandboxed pi coding agent

The [pi coding agent](https://github.com/badlogic/pi-mono) has **no permission
prompts**, so on this machine it only ever runs inside a
[Docker Sandboxes (sbx)](https://github.com/docker/sbx-releases) microVM.
The sandbox is the one and only barrier: deny-all network policy, one
persistent sandbox per project directory, and GPT-5.6 Sol via Codex OAuth as
the default model. Host Ollama models remain available as local alternatives.

Set up 2026-08-17 on Pop!_OS 24.04. Modeled after
[cuolm/pi-sbx-llamacpp](https://github.com/cuolm/pi-sbx-llamacpp).

## How it works

```
pi (wrapper, ~/.local/bin/pi)
 └─ refuses in $HOME, otherwise:
    sbx run --kit ~/.config/pi-sbx/kit pi -- "$@"
     └─ microVM per project dir (only that dir is shared read-write)
        └─ pi-sbx:local custom image with Pi and stable tools preinstalled
           ├─ default: Codex OAuth supplied by the host-side sbx proxy
           └─ optional: host Ollama via http://host.docker.internal:11434
```

- **Global sbx policy is deny-all.** The kit's `permissions.network.allow` is the
  global whitelist for every pi sandbox: host Ollama (`localhost:11434` +
  `host.docker.internal:11434` — both names for the same traffic as the proxy
  sees it), package registries (npm, PyPI, crates.io, Go proxy), GitHub
  (pi downloads its fd/ripgrep helpers from release assets), and a small
  docs/search tier (Google, DuckDuckGo, Wikipedia, Stack Overflow, MDN,
  language docs). Optional Codex access adds only `auth.openai.com` and
  `chatgpt.com`. Everything else is blocked; extend the list in
  `kit/spec.yaml` deliberately, then recreate existing sandboxes to apply.
- **pi is NOT installed on the host.** The npm global install was removed on
  purpose — otherwise nvm can prepend its bin dir to PATH and shadow the
  wrapper, letting pi run unsandboxed. Never `npm install -g` pi on the host.
- First `pi` run in a directory creates that directory's sandbox from the
  prebuilt local image; later runs re-attach instantly. The kit only activates
  image-baked dependencies and generates user-scoped skills.
- Normal Pi sandboxes mount exactly one host directory: their current project.
  The sandbox for this `pi-sbx` directory is the sole maintainer instance; it
  can edit the kit because the kit is its project.

## Files in this directory

This directory (in the dotfiles repo) is the single source of truth: the
"installed locations" below are symlinks to it, created by
`scripts/install.sh` (`~/Development/pi-sbx` also links here). Edit files
here directly — no syncing needed. Kit changes apply to newly created
sandboxes only (`sbx rm <name>` to rebuild existing ones).

| file | installed location (symlink) |
|---|---|
| `pi-wrapper.sh` | `~/.local/bin/pi` (mode 755) |
| `pi-sync.sh` | `~/.local/bin/pi-sync` (mode 755); rebuilds changed image inputs before syncing setup |
| `build-image.sh` | hashes image inputs and builds the labeled local `pi-sbx:local` image |
| `image/Dockerfile` | preinstalls Pi, Graphify, system tools, session trash support, and Node dependencies |
| `.dockerignore` | limits image build context to reviewed dependency inputs |
| `kit/` | `~/.config/pi-sbx/kit/` |
| `kit/spec.yaml` | kit definition: custom image, network allowlist, credentials, and activation command |
| `kit/files/home/.pi/agent/models.json` | lands at `/home/agent/.pi/agent/models.json` in every sandbox — registers the Ollama provider/models |
| `kit/files/home/.pi/agent/settings.json` | defaults to `openai-codex/gpt-5.6-sol` with high reasoning |
| `kit/files/home/.pi/agent/package{,-lock}.json` | pins shared extension dependencies, including `pi-hermes-memory` |
| `kit/files/home/.pi/agent/requirements-tools.txt` | pins sandbox Python helper CLIs, including `graphifyy` |
| `kit/files/home/.pi/agent/hermes-memory-config.json` | project-only memory policy; disables global/background memory writes |
| `kit/files/home/.pi/agent/extensions/` | coordinated modes, subagents, Graphify query integration, project memory, verified sbx status, Sol context control, and compact subscription footer |
| `kit/files/home/.pi/agent/scripts/` | deterministic setup adapters for installed helper tools |
| `sandboxd.service` | `~/.config/systemd/user/sandboxd.service` |

Credentials and ordinary Pi runtime state stay inside each sandbox. Project
memory and its search index live under the mounted project's
`.pi/hermes-memory/`, so they survive sandbox rebuilds. `pi-sync` copies only
an explicit allowlist of reviewed setup files from the kit into existing Pi
sandboxes; it never copies auth, sessions, caches, or arbitrary state.

## Setup from scratch

1. **Install sbx** (needs KVM and a free Docker account; the get.docker.com
   script misdetects Pop!_OS as Debian — use the direct .deb):

   ```sh
   wget -O /tmp/docker-sbx.deb \
     https://github.com/docker/sbx-releases/releases/download/v0.38.0/DockerSandboxes-linux-amd64-ubuntu2404.deb
   sudo apt-get install -y /tmp/docker-sbx.deb
   sudo usermod -aG kvm "$USER"   # then log out/in (or use: sg kvm -c "...")
   sbx login
   ```

2. **Daemon** (autostart at login; the symlink comes from `scripts/install.sh`,
   or create it by hand):

   ```sh
   ln -sf ~/dotfiles/pi-sbx/sandboxd.service ~/.config/systemd/user/sandboxd.service
   systemctl --user daemon-reload
   systemctl --user enable --now sandboxd.service
   ```

3. **Deny-all global policy** (required once; sandbox creation errors without it):

   ```sh
   sbx policy init deny-all
   ```

4. **Build the custom image, then install the kit + wrappers.** The image is
   local to the host Docker installation and must exist before the first
   sandbox uses this kit:

   ```sh
   cd ~/dotfiles/pi-sbx
   ./build-image.sh
   docker image inspect pi-sbx:local >/dev/null

   mkdir -p ~/.config/pi-sbx ~/.local/bin
   ln -sf ~/dotfiles/pi-sbx/kit ~/.config/pi-sbx/kit
   ln -sf ~/dotfiles/pi-sbx/pi-wrapper.sh ~/.local/bin/pi
   ln -sf ~/dotfiles/pi-sbx/pi-sync.sh ~/.local/bin/pi-sync
   sbx kit validate ~/.config/pi-sbx/kit
   ```

   If the installed `sbx` release cannot consume local images, use one registry
   reference consistently for the build, push, sync, and kit:

   ```sh
   PI_SBX_IMAGE='registry.example.com/team/pi-sbx:local'
   PI_SBX_IMAGE="$PI_SBX_IMAGE" ./build-image.sh
   docker push "$PI_SBX_IMAGE"
   PI_SBX_IMAGE="$PI_SBX_IMAGE" pi-sync
   ```

   Set `sandbox.image` in `kit/spec.yaml` to the identical reference:

   ```yaml
   sandbox:
     image: "registry.example.com/team/pi-sbx:local"
   ```

5. **Ollama models.** The base `qwen3.8:27b` tag has **no `num_ctx`
   parameter**, so despite the architecture's 262k maximum it actually runs at
   Ollama's 4096 default — and pi's OpenAI-compat `/v1` requests cannot set
   context per call. (Symptom of the mismatch: Ollama 500s with "no user query
   found in messages" once truncation eats the conversation.) The usable tags
   are derived ones that pin `num_ctx`:

   ```sh
   printf 'FROM qwen3:14b\nPARAMETER num_ctx 32768\n'       | ollama create qwen3-32k:14b      -f -
   printf 'FROM qwen3.8:27b\nPARAMETER num_ctx 65536\n'  | ollama create qwen3.8-64k:27b  -f -
   printf 'FROM qwen3.8:27b\nPARAMETER num_ctx 131072\n' | ollama create qwen3.8-128k:27b -f -
   ```

   All are registered in `kit/files/home/.pi/agent/models.json` with
   `"reasoning": true` so pi shows the model's thinking. They are optional
   alternatives to the Codex default. The scout subagent uses the lightweight
   `openai-codex/gpt-5.6-luna` model with thinking disabled and only read-only
   discovery tools. The 27B Ollama model already spills ~30% to CPU at 4k
   context, so a large KV cache lands mostly in system RAM — if 128k is too
   slow or fails to load, switch to `qwen3.8-64k:27b`.

6. **Smoke test** (never run pi outside the sandbox — use the wrapper):

   ```sh
   mkdir -p /tmp/pitest && cd /tmp/pitest
   pi --no-session -p "Reply with exactly: SANDBOX-OK"
   sbx rm --force pi-pitest    # clean up the test sandbox
   ```

7. **Optional: sign in to OpenAI Codex once on the host, before creating Pi
   sandboxes:**

   ```sh
   sbx secret set openai --oauth
   ```

   New Pi sandboxes receive a Pi-shaped OAuth credential file from the
   host-side sbx credential manager. Because this is a local third-party kit,
   the first launch may ask you to approve its `openai` credential binding and
   declared domains. Existing sandboxes created before enabling the credential
   must be recreated once.

   The only sandbox egress needed for subscription use is:

   - `auth.openai.com:443` for device login, token exchange, and refresh
   - `chatgpt.com:443` for the Codex model API (HTTPS and secure WebSocket)

   Pi currently parses the access-token JWT locally to derive the ChatGPT
   account ID. Therefore the kit uses sbx OAuth `passthrough: true`: the token
   is copied into each isolated VM, but no host credential directory is mounted.

## Day-to-day

```sh
cd ~/Development/someproject
pi                      # start a new saved session
pi -c                   # continue the most recently used session
pi -r                   # browse, search, rename, delete, or resume saved sessions
pi --model ollama/qwen3.8-q3-unsloth-64k:27b  # optional local model

sbx ls                  # list sandboxes
sbx rm <name>           # delete a project's sandbox (rebuilds from kit on next run)
sbx cp <name>:/path .   # copy files out of a sandbox
```

- `pi` in `~` refuses by design (it would share your whole home with the VM).
- **Sessions:** Pi saves sessions under `~/.pi/agent/sessions/` inside each
  project's persistent sandbox. Press `Ctrl+R` or run `/resume` to open the
  OpenCode-style session picker; it supports fuzzy or regex search, current/all
  scope, threaded fork lineage, recency sorting, named-only filtering, rename
  (`Ctrl+R` in the picker), and confirmed deletion (`Ctrl+D`). Use `/name` to
  title the current session, `/new` to start another, `/tree` to revisit or
  branch from an earlier turn, and `/fork` or `/clone` to create related
  sessions. The image includes `trash-cli`, so picker deletion moves session
  files to the sandbox trash instead of unlinking them. Sessions stay private
  to that sandbox and disappear when the sandbox is deleted. Submit `exit`,
  run `/exit` or `/quit`, press `Ctrl+D`, or press `Ctrl+C` twice to leave Pi
  cleanly.
- **Changing shared Pi setup:** use the one maintainer sandbox, then propagate
  from the host:

  ```sh
  cd ~/dotfiles/pi-sbx
  pi                         # ask Pi to edit kit/files/home/.pi/agent/
  pi-sync --dry-run          # review image rebuild, targets, and approved paths
  pi-sync                    # rebuild changed image inputs, then update every pi-* sandbox
  pi-sync pi-someproject     # or update one named sandbox
  ```

  `pi-sync` hashes `build-image.sh`, `.dockerignore`, `image/Dockerfile`, and
  the baked Node/Python dependency manifests. It rebuilds `pi-sbx:local` when
  that hash differs from the image label or the image is missing, then
  updates/merges only `AGENTS.md`, `SYSTEM.md`, `settings.json`, `models.json`,
  `keybindings.json`, `hermes-memory-config.json`, the dependency manifests,
  `extensions/`, setup `scripts/`, `skills/`, `prompts/`, and `themes/`. It also
  installs the pinned dependencies and generated skills. It does not prune
  removed files. Already-running Pi processes need `/reload` to load updated
  extensions, skills, prompts, themes, or memory configuration. A rebuilt image
  applies only after recreating a sandbox.
- **Operating modes:** `Shift+Tab` cycles `auto → plan → tutor → ask → auto`,
  or select one directly with `/mode auto|plan|tutor|ask`. Tutor mode returns
  staged guides for work you implement, then reviews your changes with exact
  pointers and progressively stronger hints. Ask mode is ordinary read-only
  conversation and project exploration without forced plan output. `/plan`,
  `/tutor`, and `/ask` are convenience toggles. Restricted modes expose
  `read`, `grep`, `find`, `ls`, and `graphify_query` directly and may delegate
  to the non-writing scout/planner/debugger/test-runner/reviewer agents; worker and unknown or
  project-defined agents remain blocked. Parallel dispatch supports 12 tasks
  with up to 8 running concurrently.
- **Graphify for large projects:** Graphify `0.9.50` is installed inside every
  sandbox; nothing is installed on the host. Run `/graphify .` in auto mode to
  build a local AST knowledge graph, or `/graphify query "..."` to use an
  existing one. The Pi adaptation uses writing-capable worker subagents for
  optional semantic extraction and supports 12 chunks with 8 concurrent.
  Generated output stays in the mounted project at `graphify-out/`. When a
  graph exists, the read-only `graphify_query` tool is available in every mode
  for query, explain, path, and status operations; important findings must still
  be verified against current source.
- **Project memory:** `pi-hermes-memory` is wrapped so every memory write and
  generated skill is scoped to the current project. Durable Markdown, skills,
  and the SQLite search/session index are redirected to
  `.pi/hermes-memory/` in the mounted workspace; the wrapper adds this path to
  Git's local exclude file. Global/user/failure stores, standing instructions,
  background review, correction capture, and shutdown/compaction flushes are
  disabled. Use `memory_search`, `memory_add`, `memory_replace`,
  `memory_remove`, `session_search`, and project-scoped `skill_manage` during
  normal work.
- **Verified sandbox footer:** `sbx: active` appears only when the `pi-*`
  sandbox identity matches the kernel hostname and independent runtime checks
  confirm an exact Docker 64-hex cgroup identity, a `/run/bundles` mount for
  that same identity, an overlay root, virtiofs mounts, the `buildkitsandbox`
  kernel marker, and tini as PID 1. All checks must pass. This is runtime
  evidence, not cryptographic attestation or an additional containment or
  tool-enforcement layer. Any failed check shows `sbx: unverified` in the error
  color and produces one startup warning. Run `/sbx-status` for pass/fail
  evidence without exposing container identifiers or credentials.
- **Subscription footer:** for Codex subscription models, cumulative token,
  cache, and estimated-dollar counters are hidden. The footer retains project,
  model/thinking state, extension statuses, and context utilization such as
  `19.3%/1.0M`.
- **Image maintenance:** stable binaries and dependencies belong in
  `image/Dockerfile`, not recurring kit setup commands. On the host, `pi-sync`
  automatically runs `./build-image.sh` when the build script, Docker context,
  Dockerfile, or baked Node/Python dependency manifests change. Run
  `./build-image.sh` directly only to force a rebuild, then recreate affected
  sandboxes. Keep the Dockerfile, dependency manifests, kit activation, and
  this README aligned.
- **Editing the kit:** configuration-only changes apply to new sandboxes and can
  be propagated to existing ones with `pi-sync`. The reconciler uses checksums,
  skips unchanged dependencies, activates baked dependencies when the image
  matches, and falls back to one-time installation for older images. Image,
  credential, entrypoint, and network-policy changes require recreating the
  affected sandbox with `sbx rm <name>` and launching `pi` again.
- **Containment boundary:** a normal Pi can modify only its project and its
  private VM. It cannot see other projects, the kit, other sessions, or the
  host credential store. The maintainer Pi can modify only this `pi-sbx`
  directory; propagation occurs later through the explicit host command.

## Gotchas learned the hard way

- `host.docker.internal` traffic shows up in the network policy as domain
  `localhost:11434` — that's why both spellings are in the allowlist.
- The upstream `docker/sandbox-templates:shell` image has node + corepack but
  no npm shim; `image/Dockerfile` enables npm through corepack before baking Pi
  and extension dependencies.
- Kit schema (v0.38.0): schema v2 uses `setup.install`, `files/home/`, and
  `permissions.network.allow`.
- `sbx rm` without a TTY needs `--force`; `sbx run` from scripts needs a TTY
  (`script -qec '...' /dev/null`).

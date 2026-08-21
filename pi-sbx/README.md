# pi-sbx — sandboxed pi coding agent

The [pi coding agent](https://github.com/badlogic/pi-mono) has **no permission
prompts**, so on this machine it only ever runs inside a
[Docker Sandboxes (sbx)](https://github.com/docker/sbx-releases) microVM.
The sandbox is the one and only barrier: deny-all network policy, one
persistent sandbox per project directory, host Ollama as the model backend.

Set up 2026-08-17 on Pop!_OS 24.04. Modeled after
[cuolm/pi-sbx-llamacpp](https://github.com/cuolm/pi-sbx-llamacpp).

## How it works

```
pi (wrapper, ~/.local/bin/pi)
 └─ refuses in $HOME, otherwise:
    sbx run --kit ~/.config/pi-sbx/kit pi -- "$@"
     └─ microVM per project dir (only that dir is shared read-write)
        └─ vanilla pi, installed inside the VM by the kit
           └─ host Ollama via http://host.docker.internal:11434
              (sbx proxy maps this to the host's 127.0.0.1 —
               Ollama itself needs no changes)
```

- **Global sbx policy is deny-all.** The kit's `caps.network.allow` is the
  global whitelist for every pi sandbox: host Ollama (`localhost:11434` +
  `host.docker.internal:11434` — both names for the same traffic as the proxy
  sees it), package registries (npm, PyPI, crates.io, Go proxy), GitHub
  (pi downloads its fd/ripgrep helpers from release assets), and a small
  docs/search tier (Google, DuckDuckGo, Wikipedia, Stack Overflow, MDN,
  language docs). Everything else is blocked; extend the list in `kit/spec.yaml`
  deliberately, then `sbx rm` existing sandboxes to apply.
- **pi is NOT installed on the host.** The npm global install was removed on
  purpose — otherwise nvm can prepend its bin dir to PATH and shadow the
  wrapper, letting pi run unsandboxed. Never `npm install -g` pi on the host.
- First `pi` run in a directory creates that directory's sandbox (image pull +
  pi install, one time); later runs re-attach instantly.

## Files in this directory

This directory (in the dotfiles repo) is the single source of truth: the
"installed locations" below are symlinks to it, created by
`scripts/install.sh` (`~/Development/pi-sbx` also links here). Edit files
here directly — no syncing needed. Kit changes apply to newly created
sandboxes only (`sbx rm <name>` to rebuild existing ones).

| file | installed location (symlink) |
|---|---|
| `pi-wrapper.sh` | `~/.local/bin/pi` (mode 755) |
| `kit/` | `~/.config/pi-sbx/kit/` |
| `kit/spec.yaml` | kit definition: image, network allowlist, pi install command |
| `kit/files/home/.pi/agent/models.json` | lands at `/home/agent/.pi/agent/models.json` in every sandbox — registers the Ollama provider/models |
| `kit/files/home/.pi/agent/settings.json` | default provider/model, so pi starts without an interactive picker |
| `sandboxd.service` | `~/.config/systemd/user/sandboxd.service` |

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

4. **Kit + wrapper** (symlinks, also created by `scripts/install.sh`):

   ```sh
   mkdir -p ~/.config/pi-sbx ~/.local/bin
   ln -sf ~/dotfiles/pi-sbx/kit ~/.config/pi-sbx/kit
   ln -sf ~/dotfiles/pi-sbx/pi-wrapper.sh ~/.local/bin/pi
   sbx kit validate ~/.config/pi-sbx/kit   # should pass clean
   ```

5. **Ollama models.** The base `qwen3.8:27b` tag has **no `num_ctx`
   parameter**, so despite the architecture's 262k maximum it actually runs at
   Ollama's 4096 default — and pi's OpenAI-compat `/v1` requests cannot set
   context per call. (Symptom of the mismatch: Ollama 500s with "no user query
   found in messages" once truncation eats the conversation.) The usable tags
   are derived ones that pin `num_ctx`:

   ```sh
   printf 'FROM qwen3.8:27b\nPARAMETER num_ctx 65536\n'  | ollama create qwen3.8-64k:27b  -f -
   printf 'FROM qwen3.8:27b\nPARAMETER num_ctx 131072\n' | ollama create qwen3.8-128k:27b -f -
   ```

   All are registered in `kit/files/home/.pi/agent/models.json` with
   `"reasoning": true` so pi shows the model's thinking. Default is
   `qwen3.8-128k:27b` (see `settings.json`). Note the 27B model already
   spills ~30% to CPU at 4k context on the 16GB GPU, so a large KV cache
   lands mostly in system RAM — if 128k is too slow or fails to load, switch
   to `qwen3.8-64k:27b`.

6. **Smoke test** (never run pi outside the sandbox — use the wrapper):

   ```sh
   mkdir -p /tmp/pitest && cd /tmp/pitest
   pi --no-session -p "Reply with exactly: SANDBOX-OK"
   sbx rm --force pi-pitest    # clean up the test sandbox
   ```

## Day-to-day

```sh
cd ~/Development/someproject
pi                      # runs sandboxed; only this dir + whitelisted net access
pi --model qwen3.8-64k:27b   # smaller context variant if 128k is too slow

sbx ls                  # list sandboxes
sbx rm <name>           # delete a project's sandbox (rebuilds from kit on next run)
sbx cp <name>:/path .   # copy files out of a sandbox
```

- `pi` in `~` refuses by design (it would share your whole home with the VM).
- **Changing pi / promoting extensions:** pi may reprogram itself freely
  *inside* a sandbox (per-project home). To make an extension permanent, copy
  it out (`sbx cp`) into `kit/files/home/.pi/agent/extensions/` here, then
  `sbx rm` the sandbox so it rebuilds.
- **Editing the kit:** edit here (everything is symlinked); changes apply to
  newly created sandboxes only — `sbx rm <name>` existing ones to pick them up.

## Gotchas learned the hard way

- `host.docker.internal` traffic shows up in the network policy as domain
  `localhost:11434` — that's why both spellings are in the allowlist.
- The `docker/sandbox-templates:shell` image has node + corepack but **no
  npm**; the install command falls back to `corepack npm`.
- Kit schema (v0.38.0): use `commands.install` + `files/home/` (there is no
  `setup:` field) and `caps.network.allow` (`network.allowedDomains` is
  deprecated).
- `sbx rm` without a TTY needs `--force`; `sbx run` from scripts needs a TTY
  (`script -qec '...' /dev/null`).

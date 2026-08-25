#!/usr/bin/env bash
# Propagate reviewed, non-secret Pi setup from this kit to existing Pi sandboxes.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: pi-sync [--dry-run] [SANDBOX...]

With no sandbox names, sync every existing sandbox whose name starts with
"pi-". Rebuild the local pi-sbx image first when its source inputs changed.
Only approved agent-setup paths are copied; auth, sessions, caches, and all
other files are excluded. Existing files are updated or merged, not pruned.
EOF
}

dry_run=false
declare -a requested=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "pi-sync: unknown option: $arg" >&2; usage >&2; exit 2 ;;
    *) requested+=("$arg") ;;
  esac
done

if ! command -v sbx >/dev/null 2>&1; then
  echo "pi-sync: sbx is not installed" >&2
  exit 1
fi

script_path="$(realpath -- "${BASH_SOURCE[0]}")"
script_dir="$(dirname -- "$script_path")"
source_dir="$script_dir/kit/files/home/.pi/agent"
build_script="$script_dir/build-image.sh"
image_name="${PI_SBX_IMAGE:-pi-sbx:local}"

if ! command -v docker >/dev/null 2>&1; then
  echo "pi-sync: docker is not installed" >&2
  exit 1
fi

expected_image_hash="$("$build_script" --print-input-hash)"
current_image_hash="$(docker image inspect --format '{{ index .Config.Labels "io.pi-sbx.image-input-hash" }}' "$image_name" 2>/dev/null || true)"
if [[ "$current_image_hash" == "$expected_image_hash" ]]; then
  echo "Image inputs unchanged: $image_name"
else
  if $dry_run; then
    echo "Would rebuild $image_name because image inputs changed"
  else
    echo "Rebuilding $image_name because image inputs changed"
    "$build_script"
    echo "Rebuilt $image_name; existing sandboxes keep their current image until recreated"
  fi
fi

if ((${#requested[@]} == 0)); then
  if ! sandbox_list="$(sbx ls --quiet)"; then
    echo "pi-sync: failed to list sandboxes" >&2
    exit 1
  fi
  mapfile -t requested < <(printf '%s\n' "$sandbox_list" | awk '/^pi-/')
fi

if ((${#requested[@]} == 0)); then
  echo "pi-sync: no pi-* sandboxes found"
  exit 0
fi

# Explicit allowlist: never propagate auth.json, sessions, caches, or arbitrary
# state even if the maintainer Pi creates them in the kit directory.
approved=(
  AGENTS.md
  SYSTEM.md
  settings.json
  models.json
  keybindings.json
  hermes-memory-config.json
  package.json
  package-lock.json
  requirements-tools.txt
  extensions
  scripts
  skills
  prompts
  themes
)

for sandbox in "${requested[@]}"; do
  if [[ "$sandbox" != pi-* ]]; then
    echo "pi-sync: refusing non-Pi sandbox name: $sandbox" >&2
    exit 1
  fi

  echo "Syncing setup to $sandbox"
  if ! $dry_run; then
    sbx exec -u agent "$sandbox" mkdir -p /home/agent/.pi/agent >/dev/null
  fi

  for relative in "${approved[@]}"; do
    source_path="$source_dir/$relative"
    [[ -e "$source_path" ]] || continue

    if $dry_run; then
      echo "  would copy $relative"
    else
      sbx cp "$source_path" "$sandbox:/home/agent/.pi/agent/"
      echo "  copied $relative"
    fi
  done

  if [[ -f "$source_dir/scripts/reconcile-tools.sh" ]]; then
    if $dry_run; then
      echo "  would reconcile helper tools only when manifests changed or files are missing"
    else
      sbx exec -u agent "$sandbox" bash -lc \
        'bash /home/agent/.pi/agent/scripts/reconcile-tools.sh'
    fi
  fi
done

echo "Done. Run /reload in Pi instances that are already open."

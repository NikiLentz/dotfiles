#!/usr/bin/env bash
set -euo pipefail

agent_root="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
node_stamp="$agent_root/.pi-sbx-node-deps.sha256"
python_stamp="$agent_root/.pi-sbx-python-tools.sha256"

node_hash="$(cat "$agent_root/package.json" "$agent_root/package-lock.json" | sha256sum | awk '{print $1}')"
node_ready=false
if [[ "$(cat "$node_stamp" 2>/dev/null || true)" == "$node_hash" ]]; then
  if node -e "const D=require('$agent_root/node_modules/better-sqlite3'); const d=new D(':memory:'); d.close(); require('$agent_root/node_modules/pi-hermes-memory/package.json')" >/dev/null 2>&1; then
    node_ready=true
  fi
fi

if $node_ready; then
  echo "extension dependencies unchanged"
else
  image_node_hash="$(cat /opt/pi-sbx/agent-deps/.manifest.sha256 2>/dev/null || true)"
  rm -rf "$agent_root/node_modules"
  if [[ "$image_node_hash" == "$node_hash" && -d /opt/pi-sbx/agent-deps/node_modules ]]; then
    ln -s /opt/pi-sbx/agent-deps/node_modules "$agent_root/node_modules"
    echo "activated extension dependencies from image"
  else
    cd "$agent_root"
    npm ci --omit=dev --omit=peer || COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack npm ci --omit=dev --omit=peer
    echo "installed extension dependencies"
  fi
  printf '%s\n' "$node_hash" > "$node_stamp"
fi

python_hash="$(cat "$agent_root/requirements-tools.txt" "$agent_root/scripts/install-graphify-skill.py" | sha256sum | awk '{print $1}')"
graphify_version="$(awk -F'==' '/^graphifyy==/{print $2}' "$agent_root/requirements-tools.txt")"
python_ready=false
if [[ "$(cat "$python_stamp" 2>/dev/null || true)" == "$python_hash" ]]; then
  if python3 -m graphify --version 2>/dev/null | grep -qx "graphify $graphify_version" \
    && grep -q "Pi.s subagent tool" "$agent_root/skills/graphify/SKILL.md" 2>/dev/null; then
    python_ready=true
  fi
fi

if $python_ready; then
  echo "Python helper CLIs unchanged"
else
  if ! python3 -m graphify --version 2>/dev/null | grep -qx "graphify $graphify_version"; then
    python3 -m pip install --user --break-system-packages --upgrade -r "$agent_root/requirements-tools.txt"
  fi
  python3 "$agent_root/scripts/install-graphify-skill.py"
  printf '%s\n' "$python_hash" > "$python_stamp"
  echo "reconciled Python helper CLIs and Graphify skill"
fi

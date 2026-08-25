#!/usr/bin/env bash
set -euo pipefail

script_path="$(realpath -- "${BASH_SOURCE[0]}")"
project_dir="$(dirname -- "$script_path")"
image_name="${PI_SBX_IMAGE:-pi-sbx:local}"

image_input_hash() {
  (
    cd "$project_dir"
    sha256sum \
      build-image.sh \
      .dockerignore \
      image/Dockerfile \
      kit/files/home/.pi/agent/package.json \
      kit/files/home/.pi/agent/package-lock.json \
      kit/files/home/.pi/agent/requirements-tools.txt
  ) | sha256sum | awk '{print $1}'
}

if [[ "${1:-}" == "--print-input-hash" ]]; then
  image_input_hash
  exit 0
fi
if (($# > 0)); then
  echo "Usage: build-image.sh [--print-input-hash]" >&2
  exit 2
fi

input_hash="$(image_input_hash)"
docker build --pull \
  --label "io.pi-sbx.image-input-hash=$input_hash" \
  -f "$project_dir/image/Dockerfile" \
  -t "$image_name" \
  "$project_dir"
printf 'Built %s\n' "$image_name"
printf 'Recreate a sandbox to use the new image. Existing sandboxes keep their current image.\n'

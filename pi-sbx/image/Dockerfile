FROM docker/sandbox-templates:shell

ARG PI_VERSION=0.84.3

USER root

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential \
      fd-find \
      git \
      jq \
      python3 \
      python3-pip \
      python3-venv \
      ripgrep \
      trash-cli \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip config --global set global.break-system-packages true

RUN COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack enable npm pnpm yarn \
    || (mkdir -p /usr/local/bin && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack enable --install-directory /usr/local/bin npm pnpm yarn)

RUN npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}" \
    || COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}"

COPY kit/files/home/.pi/agent/package.json kit/files/home/.pi/agent/package-lock.json /opt/pi-sbx/agent-deps/
RUN cd /opt/pi-sbx/agent-deps \
    && (npm ci --omit=dev --omit=peer || COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack npm ci --omit=dev --omit=peer) \
    && cat package.json package-lock.json | sha256sum | awk '{print $1}' > .manifest.sha256 \
    && npm cache clean --force

COPY kit/files/home/.pi/agent/requirements-tools.txt /opt/pi-sbx/requirements-tools.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir -r /opt/pi-sbx/requirements-tools.txt \
    && python3 -m graphify --version \
    && pi --version

RUN chown -R agent:agent /opt/pi-sbx

USER agent

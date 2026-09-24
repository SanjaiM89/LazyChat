# Omnia sandbox image.
# Runs the in-container agent runner (runner.mjs) with a live Chromium browser
# and file-generation libraries (PDF / XLSX / DOCX / CSV).
#
# Build:   docker build -t omnia-sandbox:latest sandbox/container
#
# Note: the Claude Agent SDK is installed best-effort (it's ~300MB). If that
# install fails, agent-sdk-engine agents fall back to the tool-loop engine.

FROM node:22-bookworm-slim

WORKDIR /app

# Install container deps first so the layer caches well.
COPY package.json ./
RUN npm install --no-audit --no-fund

# Agent SDK — optional. The runner falls back to the tool-loop engine if it's
# missing, so a failure here must not break the image build.
RUN npm install --no-audit --no-fund @anthropic-ai/claude-agent-sdk@latest \
    || echo "claude-agent-sdk install failed — agent-sdk engine will fall back to tool-loop"

# Browsers land here (must match the runtime path, set before install).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CI=true

# Chromium + OS libraries for Playwright.
RUN npx playwright install --with-deps chromium \
    && npx playwright install-deps chromium || true

# Runtime tools the agent can use via exec_command.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git unzip zip jq python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# The agent runner.
COPY runner.mjs report.mjs browser.mjs filegen.mjs search.mjs ./

# Default: hold the container open so `docker run omnia-sandbox` doesn't exit.
CMD ["node", "-e", "setInterval(()=>{},1e6)"]

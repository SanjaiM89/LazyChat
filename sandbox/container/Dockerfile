FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

RUN npm install --no-audit --no-fund @anthropic-ai/claude-agent-sdk@latest \
    || echo "claude-agent-sdk install failed — agent-sdk engine will fall back to tool-loop"

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CI=true

RUN npx playwright install --with-deps chromium \
    && npx playwright install-deps chromium || true

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git unzip zip jq python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY runner.mjs report.mjs browser.mjs browser-daemon.mjs filegen.mjs search.mjs ./

CMD ["node", "-e", "setInterval(()=>{},1e6)"]

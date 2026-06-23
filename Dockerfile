# Runner headless (SPEC-000 §8 Onda 3 · ADR 0001). Sem superfície HTTP.
# Base node:22 (alinhado ao engines do monorepo). Instala Claude Code CLI +
# supercronic (scheduler container-native) + tsx (rodar serializers TS). NUNCA
# embute segredos: SUPABASE_SECRET_KEY/CLAUDE_API_KEY entram via `fly secrets`;
# o OAuth do Claude Code e a config MCP vivem no VOLUME persistente (/data).
FROM node:22-bookworm-slim

# --- supercronic (cron container-native, loga em stdout, respeita PID 1) ------
ARG SUPERCRONIC_VERSION=v0.2.33
ARG SUPERCRONIC_SHA1SUM=71b0d58cc53f6bd72cf2f293e09e294b79c666d8
ARG SUPERCRONIC=supercronic-linux-amd64

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl python3 git tini \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSLO "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/${SUPERCRONIC}" \
  && echo "${SUPERCRONIC_SHA1SUM}  ${SUPERCRONIC}" | sha1sum -c - \
  && chmod +x "${SUPERCRONIC}" \
  && mv "${SUPERCRONIC}" "/usr/local/bin/${SUPERCRONIC}" \
  && ln -s "/usr/local/bin/${SUPERCRONIC}" /usr/local/bin/supercronic

# --- Claude Code CLI + tsx (global) -------------------------------------------
RUN npm install -g @anthropic-ai/claude-code tsx

WORKDIR /app

# Dependencies first (cache-friendly). The runner only needs skill-kit + root.
COPY package.json package-lock.json ./
COPY packages/skill-kit/package.json packages/skill-kit/package.json
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# App: scripts, skills, agents, hooks, skill-kit source (tsx runs TS directly).
COPY scripts ./scripts
COPY crontab ./crontab
COPY .claude ./.claude
COPY packages/skill-kit ./packages/skill-kit

# Persistent volume mount point for Claude Code OAuth (~/.claude) + MCP config.
ENV CLAUDE_CONFIG_DIR=/data/.claude
ENV RUNNER_LOCK_DIR=/tmp/runner.lock
VOLUME ["/data"]

RUN chmod +x scripts/*.sh

# tini as PID 1 for correct signal handling; supercronic reads the crontab.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["supercronic", "/app/crontab"]

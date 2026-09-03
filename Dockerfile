# --- build: TS -> pb_hooks / pb_migrations ----------------------------------
FROM oven/bun:1-alpine AS build

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY scripts ./scripts
COPY types ./types
COPY src ./src
RUN bun run build

# --- runtime -----------------------------------------------------------------
FROM alpine:3.22

ARG PB_VERSION=0.40.1
# auto-filled by buildkit (amd64 / arm64)
ARG TARGETARCH=amd64

RUN apk add --no-cache unzip ca-certificates \
  && addgroup -g 1000 -S pb \
  && adduser -u 1000 -S -G pb -h /pb -s /sbin/nologin pb

ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip /tmp/pb.zip
# Only pb_data is writable by pb; binary, hooks and migrations stay root-owned.
# Creating it here makes a fresh named volume inherit the ownership.
RUN unzip /tmp/pb.zip -d /pb/ && rm /tmp/pb.zip \
  && mkdir /pb/pb_data && chown pb:pb /pb/pb_data

COPY --from=build /app/pb_hooks /pb/pb_hooks
COPY --from=build /app/pb_migrations /pb/pb_migrations
COPY entrypoint.sh /entrypoint.sh

USER pb

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]

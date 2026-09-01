<div align="center">

# ⚡ pocketbase-ts-starter

**PocketBase with TypeScript hooks & migrations — typechecked, linted, shipped in a single Docker image.**

[![PocketBase](https://img.shields.io/badge/PocketBase-0.40-b8dbe4?logo=pocketbase&logoColor=white&labelColor=16161a)](https://pocketbase.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white&labelColor=16161a)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-esbuild-f9f1e1?logo=bun&logoColor=white&labelColor=16161a)](https://bun.sh)
[![Biome](https://img.shields.io/badge/Biome-lint%20%2B%20format-60a5fa?logo=biome&logoColor=white&labelColor=16161a)](https://biomejs.dev)

</div>

## How it works

Author hooks and migrations in strict TypeScript. esbuild transpiles them into the plain
JS layout PocketBase's embedded JS engine (goja) expects. The Docker image builds itself —
no compiled artifacts in git.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.svg">
  <img alt="src/ TypeScript sources are transpiled by esbuild into pb_hooks/ and pb_migrations/, which are copied into the PocketBase Docker image; vendored jsvm types drive tsc typechecking" src="docs/architecture-light.svg">
</picture>

## Quick start

```bash
cp .env.example .env       # fill in key + admin credentials
bun install
bun run build              # src/ -> pb_hooks/ + pb_migrations/
bun run up                 # docker compose up -d --build
```

Dashboard at `http://localhost:8090/_/` — migrations (example `posts` collection,
rate limiter, trusted proxy) apply on first boot, the superuser is created from `.env`.

Dev loop: `bun run watch` in one terminal; PocketBase watches `pb_hooks/` and hot-reloads.

| Script | What it does |
| --- | --- |
| `bun run build` / `watch` | transpile TS → `pb_hooks/`, `pb_migrations/` |
| `bun run check` | Biome lint + `tsc --noEmit` |
| `bun run fix` | Biome autofix + format |
| `bun run up` / `down` / `logs` | docker compose lifecycle |

## The one rule of PB hooks

PocketBase runs **every handler in an isolated context** — outer scope is unreachable, so
this starter transpiles instead of bundling. Share code via `require` *inside* the handler;
type it with an erased `import type`:

```ts
import type * as response from "./lib/response";

routerAdd("GET", "/api/ping", (e) => {
    const { json } = require(`${__hooks}/lib/response.js`) as typeof response;
    return json(e, { message: "pong" });
});
```

## Production

`compose.prod.yml` is platform-agnostic: self-contained image, named `pb_data` volume,
loopback port for host proxies — or join your proxy's docker network (Dokploy, Traefik, …)
via the commented block at the bottom.

```bash
docker compose -f compose.prod.yml up -d --build
```

Hardening baked in, driven by `.env`:

| | |
| --- | --- |
| 🔐 **Superuser IP allowlist** | `PB_SUPERUSER_IPS` → requests outside the list get 403, even with a valid token |
| 🚦 **Rate limiter** | enabled by migration with the dashboard's recommended rules |
| 🕵️ **Real client IP** | `X-Forwarded-For` trusted proxy config for reverse-proxy setups |
| 🔑 **Settings encryption** | `PB_ENCRYPTION_KEY` → SMTP/S3 secrets encrypted at rest |

Still on you: SMTP (Settings → Mail), backups to a dedicated S3 bucket (Settings → Backups),
and superuser MFA/OTP — enable it *after* SMTP works.

# DocChat

Chat with your documents: upload PDFs, Markdown or text files and ask questions.
Answers are grounded in your documents, with citations back to the source.

## Quick start

Requirements: Docker. (For local development you also need Node 24+ and pnpm.)

```bash
cp .env.example .env        # add your ANTHROPIC_API_KEY
make up                     # or: docker compose up --build -d
open http://localhost:8080
```

Local development with hot reload:

```bash
pnpm install
make dev                    # Postgres in Docker, API + web on your machine
# web: http://localhost:5173  api: http://localhost:3000/api/health
```

Quality checks (the same as CI): `make check`

## Repository layout

```
apps/api          Fastify API + ingestion worker (TypeScript)
apps/web          React + Vite frontend
packages/shared   Zod schemas: the single API contract used by both apps
docs/adr          Architecture decision records
sample-docs       A small corpus to try the app with
```

## Architecture overview

<!-- TODO(you): diagram + 1 paragraph. -->

## RAG / LLM approach and decisions

<!-- TODO(you): chunking, embedding model, vector DB, LLM, orchestration,
     prompt & context management, guardrails, quality, observability. -->

## Key technical decisions

<!-- TODO(you): link to docs/adr/*. -->

## Engineering standards followed (and skipped)

<!-- TODO(you) -->

## Productionising on AWS / GCP / Azure / Cloudflare

<!-- TODO(you) -->

## How I used AI tools

<!-- TODO(you): see CLAUDE.md for the conventions file the assistant follows. -->

## What I'd do differently with more time

<!-- TODO(you) -->

# Conventions for AI coding assistants (and humans)

This file is loaded by Claude Code on every session. It encodes the rules the
codebase follows so generated code matches them without re-explaining.

## Architecture rules

- `apps/api/src/routes/` is thin: parse input (Zod), call a service, map the result. No SQL, no SDK calls.
- `services/` holds use-cases (IngestDocument, AnswerQuestion). Depends only on `ports/` interfaces.
- `ports/` are interfaces (BlobStore, Embedder, LLMClient, ChunkRepository). `adapters/` implement them.
- `domain/` is pure: no IO, no imports from adapters. Chunking, rank fusion and prompt building live here.
- `main.ts` / `worker.ts` are the only composition roots: the only files that construct adapters.
- Every API request/response shape is a Zod schema in `packages/shared`. Never redefine it in an app.

## Code rules

- TypeScript strict. No `any`, no non-null `!`, no `as` casts except at validated boundaries.
- Validate all external input (HTTP bodies, env, LLM JSON) with Zod at the boundary.
- Errors: throw typed domain errors from services; the Fastify error handler maps them to HTTP.
- Logging: use the request-scoped `req.log` / injected logger; structured fields, never string-concatenated secrets or document content.
- No new runtime dependency without a one-line justification in the commit message or the README's Key technical decisions.

## Testing rules

- Domain logic gets unit tests (fast, no IO).
- Services are tested with fake adapters. Tests must never call a paid API.
- Repository adapters get integration tests against real Postgres (testcontainers).
- Run `make check` before declaring a change done.

## Workflow

- Small, reviewable changes. Explain the why in the summary, not just the what.
- Don't commit, push or create branches. The human reviews and commits.

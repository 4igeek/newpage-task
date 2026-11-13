.PHONY: up down logs dev db test test-integration test-e2e eval eval-answers lint typecheck check format

up:        ## Build and start the whole stack (http://localhost:8080)
	docker compose up --build -d
down:      ## Stop the stack (data volumes are kept)
	docker compose down
logs:
	docker compose logs -f api worker
db:        ## Start only Postgres, for local `pnpm dev`
	docker compose up -d db && pnpm --filter @docchat/api db:migrate
dev: db    ## Run API, worker and web locally with hot reload
	pnpm dev
test:
	pnpm test
test-integration:  ## Needs Docker (starts a throwaway pgvector container)
	pnpm test:integration
test-e2e:  ## Browser tests against a throwaway copy of the stack (needs Docker; no API key used)
	pnpm test:e2e
eval:      ## Retrieval quality report (needs Docker; no API key, free)
	pnpm eval:retrieval
eval-answers:  ## Answer quality report graded by Claude (needs Docker + API key; ~$0.45)
	pnpm eval:answers
lint:
	pnpm lint
typecheck:
	pnpm typecheck
check: lint typecheck test test-integration test-e2e  ## Everything CI runs
format:
	pnpm format

.PHONY: up down logs dev db test test-integration lint typecheck check format

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
lint:
	pnpm lint
typecheck:
	pnpm typecheck
check: lint typecheck test test-integration  ## Everything CI runs
format:
	pnpm format

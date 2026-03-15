# ── SubPlayer Makefile ────────────────────────────────────────────────
# make dev       — 本地开发，并行启动所有服务
# make build     — 构建前端
# make deploy    — 宝塔面板部署 (pm2)

.PHONY: dev dev-gateway dev-asr dev-web build deploy logs

# ── Development ──────────────────────────────────────────────────────

dev:
	@echo "🚀 Starting all services in parallel..."
	@npx concurrently \
		--kill-others-on-fail \
		--names "ASR,GW,WEB" \
		--prefix-colors "magenta,cyan,green" \
		"make dev-asr" \
		"make dev-gateway" \
		"make dev-web"

dev-gateway:
	cd services/gateway && bun run src/index.ts

dev-asr:
	@if [ -d ".venv" ]; then \
		.venv/bin/uvicorn services.asr.app.main:app --host 127.0.0.1 --port 8765 --reload; \
	else \
		echo "⚠️  No .venv found — skipping local ASR. Run: python -m venv .venv && pip install -r services/asr/requirements.txt"; \
	fi

dev-web:
	cd apps/web && bun run dev

# ── Build ────────────────────────────────────────────────────────────

build:
	cd apps/web && bun run build

# ── Deploy (宝塔面板) ────────────────────────────────────────────────

deploy:
	@echo "📦 Deploying with PM2..."
	pm2 start ecosystem.config.js
	pm2 save
	@echo "✅ Gateway running. Configure Nginx in 宝塔面板."

logs:
	pm2 logs --lines 50

# ── Setup ────────────────────────────────────────────────────────────

install:
	cd services/gateway && bun install
	cd apps/web && bun install

setup-asr:
	python -m venv .venv
	.venv/bin/pip install -r services/asr/requirements.txt

.PHONY: up down build rebuild logs ps clean setup help

help:
	@echo "Phonolith — Local Music Intelligence Engine"
	@echo ""
	@echo "  make setup    — copy .env.example → .env (edit before first run)"
	@echo "  make up       — start all services (detached)"
	@echo "  make down     — stop all services"
	@echo "  make build    — build all Docker images"
	@echo "  make rebuild  — rebuild images with --no-cache"
	@echo "  make dev      — start in foreground with live logs"
	@echo "  make logs     — tail all service logs"
	@echo "  make logs-X   — tail logs for service X (e.g. make logs-tremor)"
	@echo "  make ps       — show running containers"
	@echo "  make shell-X  — open shell in service X (e.g. make shell-api)"
	@echo "  make clean    — stop and remove all containers + volumes"

setup:
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env — edit it before running make up"; else echo ".env already exists"; fi

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

rebuild:
	docker compose build --no-cache

dev:
	docker compose up

logs:
	docker compose logs -f

logs-%:
	docker compose logs -f $*

ps:
	docker compose ps

shell-%:
	docker compose exec $* /bin/sh

clean:
	docker compose down -v
	@echo "All containers and volumes removed"

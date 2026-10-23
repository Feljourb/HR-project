DC = docker compose
# Commands that create files run as my WSL user, not root (files stay editable from VS Code).
AS_ME = -u $(shell id -u):$(shell id -g)

up:
	$(DC) up -d

down:
	$(DC) down

build:
	$(DC) up -d --build

restart:
	$(DC) restart

logs:
	$(DC) logs -f

ps:
	$(DC) ps

startapp:
	$(DC) exec $(AS_ME) backend python manage.py startapp $(name)

migrations:
	$(DC) exec $(AS_ME) backend python manage.py makemigrations

export-lists:
	$(DC) exec $(AS_ME) backend python manage.py export_lists

migrate:
	$(DC) exec backend python manage.py migrate

superuser:
	$(DC) exec backend python manage.py createsuperuser

shell:
	$(DC) exec backend python manage.py shell

test:
	$(DC) exec backend python manage.py test

clean:
	$(DC) down -v --remove-orphans

.PHONY: up down build restart logs ps startapp migrations export-lists migrate superuser shell test clean
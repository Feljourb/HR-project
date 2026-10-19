DC = docker compose

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
	$(DC) exec backend python manage.py startapp $(name)

migrations: 
	$(DC) exec backend python manage.py makemigrations

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

.PHONY: up down build restart logs ps migrations migrate superuser shell test clean
FROM python:3.13.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md ./
RUN mkdir -p app \
    && touch app/__init__.py \
    && python -m pip install --upgrade pip \
    && python -m pip install .

COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./alembic.ini

RUN mkdir -p /app/data/uploads /app/data/import /app/data/connectors

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app \
    && chown -R app:app /app

USER app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

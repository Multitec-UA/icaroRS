# syntax=docker/dockerfile:1.7
#
# icaro API — FastAPI delivery surface (issue #16).
#
# BUILD CONTEXT IS THE REPO ROOT, not apps/api: the API depends on the local
# workspace packages (icaro → rocketpy, and icaro[convert] → rocketserializer),
# so the whole uv workspace must be visible to the resolver.
#
#   docker build -f apps/api/Dockerfile -t icaro-api .
#
# Ships JDK 21 + the bundled OpenRocket .jar because POST /api/convert spawns a
# fresh JVM subprocess per conversion (services/convert_worker.py). Runs a single
# uvicorn worker: simulate holds a process-wide lock and matplotlib keeps global
# state (ADR-3) — never scale workers within the process.

# --- JDK 21 — source for the convert JVM ------------------------------------
FROM eclipse-temurin:21-jre AS jre

# --- uv — pinned, copied as a static binary ---------------------------------
FROM ghcr.io/astral-sh/uv:0.5 AS uv

# --- runtime -----------------------------------------------------------------
FROM python:3.12-slim-bookworm

# Java 21 for the OpenRocket .jar (orhelper/jpype start a JVM per convert).
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:${PATH}"

# uv binaries.
COPY --from=uv /uv /uvx /bin/

# libgomp1: rocketpy's numeric stack (numpy/scipy wheels) loads libgomp at
# runtime; the slim base doesn't ship it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg

WORKDIR /app

# The workspace. All members declared in the root pyproject must be present for
# uv to resolve the graph, even though we only sync the API's environment.
COPY pyproject.toml uv.lock ./
COPY packages/ packages/
COPY apps/cli/ apps/cli/
COPY apps/api/ apps/api/

# Install icaro-api + its [convert] (JVM convert) and [gcp] (GCS + Firestore
# persistence) extras, frozen to the lockfile. The gcp libs ship in every image;
# whether they're USED is decided at runtime by the ICARO_GCS_BUCKET /
# ICARO_FIRESTORE_PROJECT env vars (unset → ephemeral LocalFs + InMemory).
# --no-dev drops pytest et al. Editable workspace installs point back at the
# copied source, so that source must stay in the image (it does).
RUN uv sync --frozen --no-dev --package icaro-api --extra convert --extra gcp

ENV PATH="/app/.venv/bin:${PATH}"

# Bundled OpenRocket jar for convert. Override with ICARO_ORK_JAR if desired.
ENV ICARO_ORK_JAR=/app/packages/rocketserializer/OpenRocket-23.09.jar

# Per-run artifacts (PNGs, result.json, series.json). On Cloud Run the fs is an
# in-memory tmpfs — these accumulate in RAM until the instance restarts. Size
# the service memory accordingly; see DEPLOY.md.
ENV ICARO_RESULTS_DIR=/tmp/icaro_runs

# Cloud Run sends traffic to $PORT (default 8080). One worker — see header.
EXPOSE 8080
CMD ["sh", "-c", "uvicorn icaro_api.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]

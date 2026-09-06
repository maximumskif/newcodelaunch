# Not build-verified in this sandbox — no Docker available here. Written to
# match the same real, execution-verified setup docs/REBUILD_PROGRESS.md's
# "First real local execution" entry used (Python 3.11 specifically —
# newer Pythons can lack prebuilt wheels for numpy/Pillow/psycopg2-binary;
# this base image sidesteps that by starting on 3.11 directly, no uv/venv
# workaround needed the way a host with a newer system Python does). Build
# and smoke-test this (`docker build .`, then hit /api/health) before
# relying on it for a real deploy.
FROM python:3.11-slim

WORKDIR /app

# gcc/build tools are NOT installed on purpose — every pin in
# requirements.txt has a prebuilt wheel for this exact Python version (that
# was the whole point of pinning to 3.11), so a working build here without
# a compiler is itself a check that hasn't silently regressed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY migrations ./migrations
COPY wsgi.py ./

EXPOSE 5000

# Matches the one prod entry point this app has always had (see wsgi.py,
# and README's "one dev entry point / one prod entry point" architecture
# note) — flask db upgrade still needs to be run against the real target
# database before or alongside first boot, this image doesn't do it for you.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "wsgi:app"]

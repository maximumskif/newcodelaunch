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

# No apt-get step for Python packages, on purpose: every pin in requirements.txt has a prebuilt
# wheel for this exact Python version (that was the whole point of pinning
# to 3.11), including psycopg2-binary — which bundles its own libpq
# statically and needs neither a compiler nor libpq-dev at build or run
# time (that's the entire reason the "-binary" package exists; the plain
# psycopg2 package would need both). A working build here with no system
# packages installed at all is itself a check that hasn't silently regressed.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY migrations ./migrations
COPY wsgi.py ./
# docker-compose.yml's `scheduler` service runs scripts/maintenance-loop.sh
# from this same image.
COPY scripts ./scripts

# The Solidity compiler, installed now rather than by the first compile
# request. Native solc 0.8.19 exists only for x86-64; on ARM (Oracle's free
# Ampere servers) the same compiler runs as its official WebAssembly build
# through Node — byte-identical output (tests/test_solidity_backends.py).
# Node comes from Debian's own packages; it only runs solc-js.
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm && rm -rf /var/lib/apt/lists/*
COPY solcjs/package.json solcjs/package-lock.json solcjs/compile.cjs ./solcjs/
RUN cd solcjs && npm ci --omit=dev --no-audit --no-fund
RUN if [ "$(uname -m)" = "x86_64" ]; then python -c "import re, solcx; v = re.search(r'SOLC_VERSION = \"(.+?)\"', open('app/services/solidity.py').read()).group(1); solcx.install_solc(v); print('native solc', v)"; fi

EXPOSE 5000

# Matches the one prod entry point this app has always had (see wsgi.py,
# and README's "one dev entry point / one prod entry point" architecture
# note) — flask db upgrade still needs to be run against the real target
# database before or alongside first boot, this image doesn't do it for you.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "wsgi:app"]

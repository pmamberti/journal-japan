# Japan Journal

A small self-hosted photo journal with a React/Vite frontend, FastAPI backend,
SQLite metadata, and local JPEG storage.

## Production shape

- Docker Compose builds one backend and one Nginx frontend image.
- Neither service publishes a host port. Both join the external `homelab`
  network and are routed by Traefik.
- The frontend and API use the same hostname; `/api` is routed to FastAPI.
- Cloudflare Access may provide an outer login boundary, but application writes
  also require `AUTH_TOKEN`.
- `AUTH_TOKEN` is mandatory. Compose and the backend both fail closed when it
  is missing; never commit the runtime `.env`.
- Both services have healthchecks, and the frontend waits for a healthy
  backend.

## Build and deployment

The Python transitive package set, frontend package graph, and build-image
digests are locked. Update those inputs deliberately rather than replacing the
lockfiles during routine deployment.

```bash
cp .env.example .env
# Put a strong AUTH_TOKEN in .env and keep the file mode 0600.
chmod 0600 .env

docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

The external network must already exist:

```bash
docker network inspect homelab >/dev/null
```

For local frontend development, use `npm ci`, not `npm install`. For local
backend development, install `backend/requirements.lock` to reproduce the
deployed package set.

## Data and recovery

Irreplaceable state lives in:

- `data/journal.db` — SQLite entries and upload references;
- `uploads/` — the referenced JPEGs.

Those paths and `.env` are ignored by Git. Take an SQLite online backup while
the service is live, then copy exactly the upload filenames referenced by that
staged database. Do not archive a potentially changing live SQLite file with a
plain `tar` command.

The reviewed homelab deployment adds the private note, integrity manifests,
encrypted off-host backup, and isolated restore proof outside this public
repository. Logs, caches, build output, Git objects, and unreferenced files are
not recovery state.

## API security

Read endpoints are public inside the application boundary. Creating, editing,
deleting, and verifying write access require the operator token. The browser
stores that token locally after the operator enters it. Treat browser storage
and the runtime `.env` as secret-bearing.

Uploaded content is checked as an image by the application, but this is a
personal service rather than a hardened multi-tenant upload platform. Keep it
behind the intended reverse-proxy/access boundary.

## Layout

```text
backend/                 FastAPI source, locked packages, pinned image
frontend/                React/Vite source, npm lockfile, pinned build images
data/                    runtime SQLite state (ignored)
uploads/                 runtime JPEG state (ignored)
docker-compose.yml       production Compose definition
.env.example             non-secret runtime shape
```

## Operations

```bash
docker compose ps
docker compose logs --tail 100 backend frontend
```

Before an update, verify a current recovery core and review the image/source
diff. Rebuild first, then recreate only this stack and confirm both containers
are healthy with zero restarts.

## License

MIT

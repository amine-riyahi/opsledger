# OpsLedger

A work queue for small teams. Assign owners and deadlines, see overdue work, and review a history of status changes.

## Try it

Open `index.html` directly in a browser for a local demo with sample data. Demo changes stay in that browser. The hosted workspace starts empty and stores work items and activity in SQLite.

## Run the server

Use Node.js 24. Set `OPSLEDGER_PASSWORD` to a generated secret of at least 24 characters, then run `npm start`. Visit http://127.0.0.1:8080 and sign in as `opsledger`. Run `npm test` for the business logic and HTTP integration tests.

## Deploy

Build and run a single container. The command below assumes `OPSLEDGER_PASSWORD` is already exported from your environment or secret manager.

```sh
docker build -t opsledger:1.0.0 .
docker volume create opsledger-data
docker run -d --name opsledger --restart unless-stopped \
  -p 127.0.0.1:8080:8080 -e OPSLEDGER_PASSWORD \
  -v opsledger-data:/app/data opsledger:1.0.0
curl --fail http://127.0.0.1:8080/healthz
```

Put an HTTPS reverse proxy in front of the local port before exposing it publicly. Keep the origin port private. This release is designed for one shared workspace with one credential. Keep a single server instance per database and use the named volume for persistence.

### Back up and restore

Stop the container before copying the entire contents of the data volume, including any SQLite sidecar files. Store backups in restricted storage and verify a restore on a separate volume before relying on it. Restart the container after the copy.

### Release checks

GitHub Actions runs the test suite and builds the container on pushes and pull requests. After deployment, verify the HTTPS sign-in, add a work item, update its status, and confirm the item survives a container restart.

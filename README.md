# Akij Essentials Ltd. — Sales Control Tower

A production-ready, role-based sales MIS web application for the **Rice Bulk**
distribution channel. It turns raw operational data from the company's data
warehouse (DWH, exposed via an MCP SQL Server) into actionable management
information: sales orders, deliveries, pending orders, target vs achievement,
month progress, key insights, recommendations and tour planning — with a full
admin panel for users, roles, permissions and territory hierarchy.

## Tech stack

- **Backend:** Node.js 22+ · Express 4 · `node:sqlite` (built-in DB) · `mssql` (data source) · `jsonwebtoken` · scrypt password hashing
- **Frontend:** Vanilla ES-module SPA · Chart.js (vendored) · responsive CSS
- **Data source:** SQL Server `DWH` (`oms.tblSalesOrderHeaderArc` / `RowArc`, `sms.tblDeliveryHeaderArc` / `RowArc`)

## Architecture

```
Frontend (public/)
   ↓  REST /api (JWT)
Backend (Express)
   ↓  services/  (auth, RBAC, analytics, insights, recommendations, tour plan, sync)
Data Repository (server/mcp)  — the ONLY place SQL/MCP details live
   ↓
MCP / SQL Server (DWH)          +  App DB (node:sqlite: users/roles/territories/audit/config/cache)
```

The UI never touches SQL or MCP internals. All authorization is enforced
server-side from a user's role + territory scope; a user can never read data
outside their permitted scope by changing frontend parameters.

## Quick start (local)

```bash
# 1. install dependencies (Node 22+ required)
npm install

# 2. configure environment
cp .env.example .env
#   edit .env: set MSSQL_PASSWORD, JWT_SECRET

# 3. run
npm start            # -> http://localhost:8080
#    or
npm run dev          # auto-reload during development

# 4. run tests
npm test
```

### Default login

On first boot an administrator is created:

- **Username:** `admin`
- **Password:** `admin123` (change it immediately — or set `ADMIN_INITIAL_PASSWORD` before first run)

## Data model

The data repository (`server/mcp/schema.js`) documents the discovered DWH
schema and maps it to a normalized fact model:

| Domain       | Tables |
|--------------|--------|
| Sales Orders | `oms.tblSalesOrderHeaderArc` + `oms.tblSalesOrderRowArc` |
| Delivery     | `sms.tblDeliveryHeaderArc` + `sms.tblDeliveryRowArc` |

Confirmed columns include order date, order no, customer
(`strSoldToPartnerName`), item/UOM, order quantity/value, delivery
quantity/value. Territory/customer/status columns that could not be confirmed
are auto-discovered from `INFORMATION_SCHEMA` at startup (see
`server/mcp/schema.js` candidate lists).

Targets are stored in the app database (admin-managed), because the warehouse
does not expose a confirmed target table.

## Automatic refresh

Operational data is synced every 5 minutes (`SYNC_INTERVAL_MS`, default
`300000`) by a background job with retry, status tracking and a "Data last
updated" indicator. The UI polls for freshness without reloading the page.
If the source is unavailable the app keeps serving with an explicit
"data source unavailable" state.

## Sync bridge (for when the DWH is not reachable from the host)

If the app is hosted where the DWH is not reachable (e.g. Vercel), run the
bridge on a machine that *can* reach the DWH (your office PC). It reads the
data and pushes it to the app every 5 minutes, keeping the database private:

```bash
# on the office PC, in the project root:
node bridge/sync-worker.js
```

Set `SYNC_TARGET_URL` (deployed app URL) and `SYNC_SECRET` (must match the
app's `SYNC_SECRET`) — see `bridge/.env.example`.

## Deployment (free tier)

### Render.com (recommended — one click)

1. Push this folder to a Git repository.
2. On [render.com](https://render.com) → **New → Web Service** → point at the repo.
   The included `render.yaml` configures the Docker build, health check
   (`/api/health`), environment variables and a persistent disk for the app DB.
3. Set `MSSQL_PASSWORD` and `JWT_SECRET` in the environment settings.

### Docker (any host)

```bash
docker build -t akij-sales .
docker run -p 8080:8080 -e MSSQL_PASSWORD=... -e JWT_SECRET=... -v akij-data:/app/data akij-sales
```

### Other platforms

`Procfile` is included for Heroku/Koyeb-style platforms.

> **Note on free hosting:** free plans often use ephemeral or small disks.
> Operational sales data always comes live from the warehouse; only app
> metadata (users/roles/targets/audit) is persisted locally, so a
> persistent disk (or a mounted volume) is recommended to retain it.

## Environment variables

See `.env.example` for the full list. Key ones:

| Variable | Purpose |
|----------|---------|
| `MSSQL_*` | DWH connection (server, user, password, database) |
| `JWT_SECRET` | session token signing secret |
| `APP_DB_PATH` | app database location |
| `SYNC_INTERVAL_MS` | auto-refresh interval |
| `FINANCIAL_YEAR_START_MONTH` / `WEEKEND_DAYS` | business calendar |
| `ADMIN_INITIAL_PASSWORD` | first-boot admin password |

## Security

- scrypt password hashing, JWT sessions, rate limiting on auth
- RBAC enforced server-side; hierarchical territory scope resolution
- audit log of login/logout/user/role/permission/territory actions
- input validation, parameterized SQL (no string concatenation), no secrets on the frontend

## Project layout

```
server/
  config.js, db.js, app.js, index.js
  lib/         passwords, tokens, dates, format, csv, errors
  mcp/         schema.js (discovered DWH schema), client.js (data repository)
  middleware/  auth, rbac, rate-limit, error handling
  repos/       users, roles, territories, targets, config, audit, sync
  services/    auth, RBAC/scope, sync, analytics, month-progress, insights, recommendations, tour plan
  routes/      auth, dashboard, operational, analytics, admin
public/        SPA (HTML + ES modules + vendored Chart.js)
tests/         node:test suite (auth, RBAC, hierarchy, analytics, pending, insights, tour plan)
```

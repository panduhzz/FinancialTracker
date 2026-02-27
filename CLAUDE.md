# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Frontend

```bash
npm install              # Install frontend dependencies
npm run dev              # Inject env vars into HTML files + serve frontend at http://localhost:3000
npm run build            # Inject env vars only (no server)
npm start                # Serve frontend without env injection (http://localhost:3000)
```

### Backend (main API)

```bash
cd backend
pip install -r requirements.txt
func start               # Start Azure Functions at http://localhost:7071
```

### Backend (document intelligence upload service)

```bash
cd backend_upload
pip install -r requirements.txt
func start --port 7072   # Start at http://localhost:7072
```

### Local Storage Emulator

```bash
azurite --silent         # Must be running before starting the backend
```

## Local Environment Setup

1. Copy `backend/local.settings.json.template` → `backend/local.settings.json` (pre-configured for Azurite)
2. Create `.env.development` in the project root:
   ```
   REACT_APP_API_URL=http://localhost:7071/api
   REACT_APP_ENVIRONMENT=development
   REACT_APP_DEBUG=true
   ```
3. Start Azurite, then `func start` in `backend/`, then `npm run dev` from the root.

The `build-local.js` script injects env vars as `window.REACT_APP_*` globals into the four HTML pages. It also strips any previously injected script blocks before re-injecting, so running `npm run dev` multiple times is safe.

## Architecture Overview

### Frontend (vanilla JS, no bundler)

All frontend files live in `src/`. There is no build pipeline beyond the env-var injection step. Each HTML page directly includes `<script>` tags for shared modules in this load order:
1. MSAL.js (CDN) + Chart.js (CDN)
2. `config.js` — `API_CONFIG` object (env-aware URL resolution)
3. `authService.js` — singleton `AuthService` class (MSAL wrapper, token acquisition, cached fetch)
4. `cache.js` — `DataCache` class (LRU + TTL, backed by localStorage)
5. `utils.js` — shared UI helpers (`showLoading`, `showMessage`, `formatTransactionDate`, `handleSignOut`)
6. Page-specific JS (`financialTracking.js`, `accounts.js`, `charts.js`)

All shared objects are attached to `window` (e.g. `window.dataCache`, `window.AuthService`, `window.API_CONFIG`).

### Authentication Flow

`AuthService` (singleton in `authService.js`) wraps MSAL.js for Azure AD B2C. All API calls go through `AuthService.makeAuthenticatedRequest()`, which:
- Checks `window.dataCache` for cached GET responses before fetching
- Acquires an access token silently (falls back to popup)
- Sends `Authorization: Bearer <token>` header
- Caches successful GET responses by `METHOD_URL` key

The B2C tenant is `PanduhzProject` / policy `B2C_1_testonsiteflow`. The client ID is `e8c1227e-f95c-4a0a-bf39-f3ce4c78c781`.

### Caching Strategy

`DataCache` (`cache.js`) uses an in-memory `Map` with per-entry TTLs and LRU eviction (max 50 entries). The cache is persisted to and restored from `localStorage`. TTLs by endpoint type:
- Accounts: 10 min, financial summary: 5 min, recent transactions: 2 min
- Monthly analytics: 30 min, balance history: 15 min, search results: 1 min

`window.cacheInvalidation` provides helper methods to bulk-invalidate related cache groups after mutations.

### Backend (Python Azure Functions)

`backend/function_app.py` contains all API endpoints as a single-file `FunctionApp`. Key patterns:

- **Error hierarchy**: `APIError` → `ValidationError`, `AuthenticationError`, `AuthorizationError`, `NotFoundError`, `BusinessLogicError`, `DatabaseError`
- **`ResponseBuilder`**: static helper that produces `func.HttpResponse` with CORS headers (`Content-Type`, `Access-Control-Allow-Origin: *`)
- **`@handle_api_errors` decorator**: wraps endpoint handlers to catch `APIError` subclasses and `ValueError`, log appropriately, and return structured JSON errors
- **`get_user_id_from_request()`**: extracts user ID from JWT (`oid`/`sub` claim) without full signature verification; falls back to `X-User-ID` header in dev
- **Storage**: Azure Table Storage via `AZURITE_CONNECTION_STRING` env var. Tables: `UserAccounts`, `Transactions`, `Categories`
- **`ensure_tables_exist()`**: called on first access to auto-create required tables

The upload service (`backend_upload/function_app.py`) is a separate Azure Function that handles receipt/bank statement parsing via Azure Document Intelligence and Azure Blob Storage.

### Data Storage (Azure Table Storage)

- `UserAccounts` — PartitionKey = user OID, RowKey = account UUID
- `Transactions` — PartitionKey = user OID, RowKey = transaction UUID
- `Categories` — PartitionKey = user OID, RowKey = category name

### Routing

`routes.json` configures Azure Static Web Apps URL routing. Clean URLs (`/dashboard`, `/accounts`, `/login`) map to files in `src/`. All unmatched routes fall back to `src/index.html` except `/api/*` and `/.well-known/*`.

### CI/CD

Three independent GitHub Actions workflows trigger on path-specific pushes to `main`:
- `src/` changes → deploy to Azure Static Web Apps
- `backend/` changes → deploy main API to Azure Functions (`panduhz-financial-tracker`)
- `backend_upload/` changes → deploy upload service to separate Azure Functions app

The frontend build step runs `build-local.js` with production env vars injected from GitHub Secrets.

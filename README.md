# FinancialTracker

A full-stack personal finance web application for managing bank accounts, tracking transactions, and visualizing financial data. Built with vanilla JavaScript on the frontend and Python Azure Functions on the backend, deployed to Azure Static Web Apps.

## Features

- **Multi-Account Management** - Create and manage checking, savings, credit, and investment accounts with custom creation dates and initial balances
- **Transaction Tracking** - Add, search, and delete transactions with categories, descriptions, and date tracking
- **Recurring Transactions** - Set up and process recurring income/expenses automatically
- **Financial Analytics** - View monthly spending summaries, balance history charts, and account-level breakdowns
- **Receipt Parsing** - Upload receipts and bank statements for automatic data extraction via Azure Document Intelligence
- **Client-Side Caching** - LRU cache with TTL-based expiration and localStorage persistence to minimize API calls
- **Authentication** - Azure AD B2C integration with MSAL.js for secure user login

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript, Chart.js |
| Authentication | Azure AD B2C, MSAL.js, JWT |
| Backend API | Python 3.11, Azure Functions |
| Document Processing | Azure Document Intelligence, Azure Blob Storage |
| Database | Azure Table Storage |
| Hosting | Azure Static Web Apps |
| CI/CD | GitHub Actions |

## Project Structure

```
FinancialTracker/
├── src/                          # Frontend
│   ├── index.html                # Login page (MSAL.js auth)
│   ├── loggedIn.html             # Post-login landing page
│   ├── financialTracking.html/js # Dashboard - overview, transactions, charts
│   ├── accounts.html/js          # Account management
│   ├── auth.js                   # MSAL authentication & token handling
│   ├── cache.js                  # DataCache class (LRU, TTL, localStorage)
│   ├── charts.js                 # Chart.js balance history visualizations
│   ├── config.js                 # API URL config with environment detection
│   └── utils.js                  # Shared UI helpers & formatting
├── backend/                      # Main API (Azure Functions)
│   ├── function_app.py           # All API endpoints
│   ├── requirements.txt          # Python dependencies
│   ├── host.json                 # Azure Functions host config
│   └── local.settings.json.template
├── backend_upload/               # Document Intelligence service
│   ├── function_app.py           # Receipt/document upload endpoint
│   ├── requirements.txt          # Python dependencies
│   └── host.json                 # Azure Functions host config
├── scripts/
│   └── build-local.js            # Injects env vars into HTML files
├── .github/workflows/            # CI/CD pipelines
│   ├── azure-functions-deploy.yml
│   ├── azure-static-web-apps-black-sand-0fa8bd51e.yml
│   └── document-intelligence-function-deploy.yml
├── routes.json                   # Azure Static Web Apps routing
└── package.json
```

## API Endpoints

### Accounts
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/accounts` | Create a bank account |
| `GET` | `/api/accounts` | List all user accounts |
| `DELETE` | `/api/accounts/{account_id}` | Delete an account |
| `GET` | `/api/accounts/summary/{account_id}` | Get account summary |

### Transactions
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/transactions` | Add a transaction |
| `DELETE` | `/api/transactions/{transaction_id}` | Delete a transaction |
| `GET` | `/api/transactions/recent` | Get recent transactions |
| `GET` | `/api/transactions/search` | Search by description/category |

### Analytics
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/financial-summary` | Overall financial summary |
| `GET` | `/api/analytics/monthly-summary` | 12-month spending breakdown |
| `GET` | `/api/analytics/balance-history` | Multi-account balance trends |
| `GET` | `/api/analytics/account-history/{account_id}` | Account balance over time |
| `GET` | `/api/analytics/account-balance` | Chart data with Y-axis scaling |

### Recurring Transactions
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/recurring-transactions` | List recurring transactions |
| `POST` | `/api/recurring/process` | Process recurring transaction history |

### Document Intelligence
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/financialUpload` | Upload receipt/document for parsing |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Python 3.11](https://www.python.org/)
- [Azure Functions Core Tools](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local)
- [Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) (local storage emulator)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/<your-username>/FinancialTracker.git
   cd FinancialTracker
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Configure the backend**
   ```bash
   cp backend/local.settings.json.template backend/local.settings.json
   ```
   The template is pre-configured to use Azurite for local development.

4. **Install backend dependencies**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

5. **Start Azurite** (local Azure Table Storage emulator)
   ```bash
   azurite --silent
   ```

6. **Start the backend**
   ```bash
   cd backend
   func start
   ```

7. **Start the frontend** (in a separate terminal)
   ```bash
   npm run dev
   ```
   This injects environment variables and serves the frontend at `http://localhost:3000`.

### Environment Variables

Create a `.env.development` file in the project root for local development:

```env
REACT_APP_API_URL=http://localhost:7071/api
REACT_APP_ENVIRONMENT=development
REACT_APP_DEBUG=true
```

For production, these are set via GitHub Secrets and injected during the CI/CD build step.

## Deployment

Deployment is handled automatically via GitHub Actions on push to `main`:

| Workflow | Trigger | Deploys |
|---|---|---|
| **Azure Static Web Apps CI/CD** | Changes in `src/` | Frontend to Azure Static Web Apps |
| **Deploy Azure Functions** | Changes in `backend/` | Main API to Azure Functions |
| **Document Intelligence Function Deploy** | Changes in `backend_upload/` | Upload service to Azure Functions |

### Required GitHub Secrets

- `AZURE_STATIC_WEB_APPS_API_TOKEN_BLACK_SAND_0FA8BD51E` - Static Web Apps deployment token
- `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` - Main backend publish profile
- `AZURE_DIFUNCTIONAPP_PUBLISH_PROFILE` - Document Intelligence backend publish profile
- `AZURE_RBAC_CREDENTIALS` - Azure service principal credentials
- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` - Document Intelligence endpoint URL
- `AZURE_DOCUMENT_INTELLIGENCE_KEY` - Document Intelligence API key
- `REACT_APP_API_URL` - Production API base URL
- `REACT_APP_ENVIRONMENT` - Set to `production`
- `REACT_APP_DEBUG` - Set to `false`

## Routes

| Path | Page |
|---|---|
| `/` | Login |
| `/signin` | Login |
| `/login` | Post-login landing |
| `/dashboard` | Financial tracking dashboard |
| `/financial-tracking` | Financial tracking dashboard |
| `/accounts` | Account management |

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

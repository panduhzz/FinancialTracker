# Firebase Authentication Setup

This project uses Firebase Authentication (Google sign-in) in place of Azure AD B2C.
No infrastructure changes were required — Azure Static Web Apps, Azure Functions, and Azure Table Storage are all unchanged.

---

## Step 1 — Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project**
3. Name it (e.g. `FinancialTracker`) — uncheck Google Analytics (not needed)
4. Click **Create project**

---

## Step 2 — Enable Authentication

1. In the left sidebar click **Build → Authentication**
2. Click **Get started**
3. Under the **Sign-in method** tab, enable:
   - **Google** — recommended (one-click sign-in, no password management)
     - Click the toggle, set a public-facing project name, choose your support email, click **Save**
4. Under **Settings → Authorized domains**, add your production domain
   (e.g. `black-sand-0fa8bd51e.azurestaticapps.net`) — `localhost` is already allowed by default

---

## Step 3 — Register a web app and get your config

1. In the left sidebar click the **gear icon → Project settings**
2. Scroll to **Your apps** → click the **`</>`** (web) icon
3. Give it a nickname (e.g. `Financial Tracker Web`) — do **not** enable Firebase Hosting
4. Click **Register app**
5. Firebase shows a config block like:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

You only need **three** of these values:
- `apiKey` → `REACT_APP_FIREBASE_API_KEY`
- `authDomain` → `REACT_APP_FIREBASE_AUTH_DOMAIN`
- `projectId` → `REACT_APP_FIREBASE_PROJECT_ID`

---

## Step 4 — Store the values

### Locally (`.env.development`)

```
REACT_APP_API_URL=http://localhost:7071/api
REACT_APP_UPLOAD_API_URL=http://localhost:7072/api
REACT_APP_ENVIRONMENT=development
REACT_APP_DEBUG=true
REACT_APP_FIREBASE_API_KEY=AIzaSy...
REACT_APP_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your-project-id
```

### Backend (`backend/local.settings.json`)

Add to the `Values` block:
```json
"FIREBASE_PROJECT_ID": "your-project-id"
```

### Production — GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret name | Value |
|---|---|
| `REACT_APP_FIREBASE_API_KEY` | your Firebase API key |
| `REACT_APP_FIREBASE_AUTH_DOMAIN` | `your-project-id.firebaseapp.com` |
| `REACT_APP_FIREBASE_PROJECT_ID` | `your-project-id` |
| `FIREBASE_PROJECT_ID` | `your-project-id` |

> The first three are injected into the frontend HTML at build time.
> `FIREBASE_PROJECT_ID` is passed to the Azure Function to validate the `aud` claim in ID tokens.

---

## Verification steps

1. Run `npm run dev` — confirm env vars inject `window.REACT_APP_FIREBASE_*` into HTML
2. Start Azurite + `func start` in `backend/`
3. Open `http://localhost:3000` — click **Sign In** — a Firebase Google popup should appear
4. After login, confirm redirect to `/loggedIn.html` and user name/email display correctly
5. Navigate to `/dashboard` — confirm transactions and accounts load (API calls succeed)
6. Open browser devtools → Network → verify `Authorization: Bearer <token>` header is present and the backend returns 200s
7. Sign out — confirm redirect to `/index.html` and `localStorage` cleared

---

## Notes

- Firebase `uid` (the `sub` claim in ID tokens) is used as the Azure Table Storage partition key, replacing the previous B2C `oid` claim.
- Existing records created under B2C user IDs will not be visible under the new Firebase user IDs (expected for a fresh start).
- The Firebase compat SDK (`firebase-app-compat.js` + `firebase-auth-compat.js`) is loaded from Google's CDN — no npm install or bundler required.

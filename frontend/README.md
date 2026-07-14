# Evidence Desk · Frontend

Authenticated product shell for the enterprise RAG API.

## Stack

- React 19 + TypeScript (strict)
- Vite (http://localhost:3000)
- React Router
- TanStack Query
- oidc-client-ts (Authorization Code + PKCE)
- React Hook Form + Zod
- CSS Modules + semantic CSS variables
- Vitest + Playwright

## Quick start

```powershell
cd frontend
copy .env.example .env
# set VITE_HOST_IP to a host the browser can reach for Keycloak :18080 and API :8000
npm install
npm run dev
```

Open http://localhost:3000

## Auth contract

1. Keycloak Authorization Code Flow + PKCE
2. Authority: `http://{VITE_HOST_IP}:18080/realms/enterprise-rag`
3. Client: `enterprise-rag-web`
4. Callbacks: `/auth/callback`, `/auth/silent-callback`
5. Post-logout: `/login`
6. OIDC state in `sessionStorage` (never localStorage for access tokens)
7. Authorization source after login: `GET /api/v1/auth/me`

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite on port 3000 |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit tests |
| `npm run build` | Production build |
| `npm run test:e2e` | Playwright public + Keycloak PKCE auth (needs Keycloak + API) |
| `npm run test:e2e:install` | Install Playwright Chromium |

Authenticated e2e credentials (not logged):

```powershell
$env:E2E_USERNAME="rag-admin"
$env:E2E_PASSWORD="admin_change_me"   # local Keycloak demo password
npm run test:e2e
```

## Notes

- Do not use Password / Direct Access Grant in the browser.
- Do not log tokens.
- Route pages under `/app/*` ship honest empty states until feature UIs land.

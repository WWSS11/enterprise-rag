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

```bash
cd frontend
cp .env.example .env
# edit public/config.json with browser-reachable API and OIDC endpoints
npm ci
npm run dev
```

Open http://localhost:3000

## Runtime configuration

The browser loads `public/config.json` before React starts. These values are public and must never
contain API keys, passwords, or tokens. Legacy `VITE_*` values remain available as a local
development fallback.

## Auth contract

1. Keycloak Authorization Code Flow + PKCE
2. Authority: `config.json` 中的 `oidcAuthority`
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
| `npm run test:e2e` | Deterministic Playwright suite in Chromium, Firefox, and WebKit |
| `npm run test:e2e:install` | Install Playwright Chromium, Firefox, and WebKit |

The default E2E command excludes tests that require Keycloak, the API, or live model providers. To
include the real Keycloak PKCE tests, set `E2E_EXTERNAL_SERVICES=1`. To include the live RAG test as
well, set `E2E_LIVE_RAG=1`; this also enables the Keycloak/API tests.

Authenticated E2E credentials are never logged:

```bash
export E2E_USERNAME="rag-admin"
export E2E_PASSWORD="admin_change_me"   # local Keycloak demo password
export E2E_EXTERNAL_SERVICES="1"
npm run test:e2e
```

## Notes

- Do not use Password / Direct Access Grant in the browser.
- Do not log tokens.
- Route pages under `/app/*` ship honest empty states until feature UIs land.

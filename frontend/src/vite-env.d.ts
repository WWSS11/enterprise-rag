/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HOST_IP?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_ORIGIN?: string;
  readonly VITE_OIDC_AUTHORITY?: string;
  readonly VITE_OIDC_CLIENT_ID: string;
  readonly VITE_OIDC_SCOPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

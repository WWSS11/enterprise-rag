import type { AuthDict } from "../zh-CN/auth";

export const authEn = {
  loginTitle: "Evidence Desk",
  loginLead:
    "Sign in with your organization identity to access chat, knowledge bases, jobs, and evaluation. Answers stay inspectable; authorization comes from the API identity endpoint.",
  connection: "Connection",
  authority: "Authority",
  client: "Client",
  api: "API",
  flow: "Flow",
  flowValue: "Authorization Code + PKCE",
  continueSso: "Continue with SSO",
  redirectingIdp: "Redirecting to identity provider…",
  loginNote:
    "Password grant is not used in the browser. Access tokens stay out of localStorage and are never logged.",
  checkingSession: "Checking session…",
  completingSignIn: "Completing sign-in…",
  renewingSession: "Renewing session…",
  restoringSession: "Restoring session…",
  signInIncompleteTitle: "Sign-in incomplete",
  signInIncompleteBody:
    "The identity provider returned to the app, but the authorization code could not be exchanged. No tokens were logged.",
  signInFailed: "Could not start sign-in.",
  backToSignIn: "Back to sign in",
  identityUnavailableTitle: "Identity unavailable",
  identityUnavailableBody:
    "Sign-in succeeded at the identity provider, but the application could not load GET /api/v1/auth/me. The UI uses that response as the authorization source — not raw JWT claims.",
  identityLoadFailed: "Could not load identity from the API.",
  retryIdentity: "Retry identity",
  tenant: "Tenant",
  user: "User",
  roles: "Roles",
  groups: "Groups",
  authMethod: "Auth method",
  access: "Access",
  admin: "Administrator",
  roleAdmin: "Administrator",
  roleUser: "Standard user",
  roleUnknown: "Role {{role}}",
} as const satisfies AuthDict;

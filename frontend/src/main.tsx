import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { config, loadRuntimeConfig } from "@/config/env";
import { configureValidation } from "@/security/configureValidation";
import { installContentSecurityPolicy } from "@/security/contentSecurityPolicy";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@/styles/tokens.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}
const appRootElement = rootElement;

configureValidation();

async function bootstrap(): Promise<void> {
  await loadRuntimeConfig();
  installContentSecurityPolicy(config);
  const { App } = await import("@/App");
  createRoot(appRootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap().catch((error: unknown) => {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`Application configuration failed: ${detail}`);
  appRootElement.textContent = "应用配置加载失败，请联系管理员。";
});

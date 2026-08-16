import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function vendorChunk(id: string): string | undefined {
  if (!id.includes("/node_modules/")) return undefined;

  if (/\/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) {
    return "vendor-react";
  }
  if (id.includes("/node_modules/@tanstack/")) return "vendor-query";
  if (/\/node_modules\/(i18next|react-i18next)\//.test(id)) return "vendor-i18n";
  if (id.includes("/node_modules/oidc-client-ts/")) return "vendor-oidc";
  if (/\/node_modules\/(react-hook-form|@hookform\/resolvers)\//.test(id)) {
    return "vendor-forms";
  }
  if (id.includes("/node_modules/zod/")) return "vendor-zod";

  return undefined;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 3000,
    strictPort: true,
  },
});

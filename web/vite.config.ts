import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: [
      "monadmarbles-production.up.railway.app",
      "monadmarbles-testnet-web-production.up.railway.app",
    ],
  },
});

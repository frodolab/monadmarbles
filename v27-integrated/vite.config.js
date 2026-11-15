// Frontend and local PIN API share one browser origin via Vite's proxy.
import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url));
export default defineConfig({
 server:{proxy:{'/api':{target:'http://127.0.0.1:3001',changeOrigin:false}}},
 build:{rollupOptions:{input:{lobby:resolve(directory,'index.html'),race:resolve(directory,'race.html')}}}
});

# Monad Marbles V28 — Simple Developer Password

This is the V27 integrated lobby, 3D race, and podium with a **local-only** password instead of the developer API server.

## Run
1. Open this folder in VS Code.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open the localhost link and click **Dev Access**.
5. Enter the default password **1221**.

To change the password, open `index.html`, search for `const DEV_PASSWORD`, and replace `1221`.

Developer mode is locked again after a page refresh. There is no `.env` file, backend API, or origin configuration.

**Security:** The password is stored in browser-delivered JavaScript and can be read or bypassed by anyone inspecting the source. This is suitable only for a local prototype. Do not deploy this version as security for real multiplayer actions, wallets, deposits, or payouts. Use server-side authorization before any public or financial launch.

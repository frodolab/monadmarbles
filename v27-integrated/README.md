# Monad Marbles V27 — Patterned marbles, PIN-gated developer mode and two-stage countdown

This builds directly on V26's Reagan V34 lobby, 3D funnel and obstacle race, full-course safety walls, cinematic curtains and 3D winners' podium. The racetrack physics are unchanged.

## Start in VS Code

1. Unzip the project and open the folder in VS Code.
2. Make a copy of `.env.example` named `.env`. Set `OPERATOR_PIN` to your own private PIN. **Do not share `.env` or commit it.**
3. In a terminal run `npm install` once.
4. Run `npm run dev`. This runs both the Node developer API (port 3001) and Vite frontend (port 5173).
5. Open the localhost URL printed by Vite. Opening the HTML files directly will not enable the developer API.

## What's new

- **Readable rolling marbles:** all 14 palette options now have glossy asymmetric ribbon, dot and accent patterns. Textures rotate with the physical Rapier sphere, so rolling is more visible. The winners' podium uses the matching designs.
- **Locked by default:** only the current active map label appears at top left, no dropdown or dev panel. A subtle **Dev Access** button is at the bottom right of the lobby.
- **PIN modal:** masked input, Enter to submit, error messaging, cancel, lock again. PIN verification runs on the local Node API, not in frontend source. No PIN is included in this ZIP.
- **Server-validated developer actions:** bot additions, timer start/pause, map changes, and force start each require a valid ephemeral bearer token; the backend rejects requests with no token. Wrong PIN attempts are rate-limited (6 per 15 minutes). The token lives only in memory, so refreshing the page locks the controls again. Tokens expire after 2 hours.
- **90-second registration countdown:** original bowl timer flashes ivory/red at 0:05 through 0:01. At zero it stops, locks registration and removes the warning.
- **Separate pre-race countdown:** clearly displays **RACE STARTS IN 10 ... 1** over the bowl for 10 seconds. Only afterward does the original **LETS ROLL NOW!** curtain reveal the 3D race. Developer **RACE NOW** skips waiting when at least two entrants are present.

## Important limits of the prototype

**This remains a local single-browser preview, not a live multiplayer or funded race.** The backend validates developer API calls, but each browser still owns its own local preview lobby, physics and winner; it is not yet an authoritative multiplayer race coordinator. Frontend rendering/state can always be manipulated in a user's own browser. Do **not** connect real deposits or claim that this PIN implementation alone secures payments, entries, race results or map selection across multiple users. That requires moving entrants, clock, race configuration and physics/results to an authoritative shared server and validating transactions there.

Mock wallet selection does not connect a real wallet. Prize amounts remain illustrative. The server API binds only to `127.0.0.1` for local development; it must be integrated behind an authenticated backend when deploying publicly. Do not use a weak PIN or share `.env` with teammates.

## Testing

- `npm run test:security` tests the Node API's authentication, unauthorized requests, rate limiting primitives, and logout.
- `npm run build` builds both pages for static hosting, but static hosting alone cannot run the developer API.
- Visually verify the full 60-marble race, timer warning, PIN unlock/lock, curtain transition, and decorated spinning marbles in your local browser.

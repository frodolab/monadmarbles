import { useEffect, useMemo, useState } from "react";
import BowlScene from "./components/BowlScene";
import RaceScene from "./components/RaceScene";
import { DESIGNS } from "./game";
import { useLobby } from "./hooks/useLobby";

export default function App() {
  const { room, frame, mode, hasServerUrl, join, fill, start, reset } = useLobby();
  const [nickname, setNickname] = useState("");
  const [designIndex, setDesignIndex] = useState(0);
  const [operatorPin, setOperatorPin] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 120);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setNotice("");
  }, [room.roundId]);

  const currentDesign = DESIGNS[designIndex];
  const isLobby = room.phase === "lobby";
  const showingRace = room.phase === "racing" || room.phase === "finished";
  const pool = (room.entries.length * room.demoEntryFee).toFixed(1);
  const countdown = room.startsAt === null
    ? 0
    : Math.max(0, Math.ceil((room.startsAt - clock) / 1000));
  const winner = useMemo(
    () => room.entries.find((entry) => entry.id === room.winnerId),
    [room.entries, room.winnerId],
  );
  const leaders = useMemo(
    () => [...(frame?.marbles || [])]
      .sort((a, b) => b.progress - a.progress)
      .slice(0, 10)
      .map((marble) => ({
        ...marble,
        player: room.entries.find((entry) => entry.id === marble.id),
      })),
    [frame, room.entries],
  );

  async function operate(action: () => Promise<{ ok: boolean; error?: string }>, message: string) {
    setBusy(true);
    const result = await action();
    setNotice(result.ok ? message : (result.error || "Action failed."));
    setBusy(false);
  }

  async function addMarble() {
    await operate(
      () => join(nickname, designIndex),
      mode === "shared" ? "Demo marble added to the shared bowl!" : "Added to local demo only.",
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo">M</div>
          <div>
            <div className="eyebrow">MONAD BLITZ · BETA 3</div>
            <h1>MONAD <span>MARBLES</span></h1>
          </div>
        </div>
        <div className={"connection " + (mode === "shared" ? "online" : "offline")}>
          <span className="dot" />
          {mode === "shared" ? "LIVE · SHARED PHYSICS" : mode === "connecting" ? "CONNECTING…" : "LOCAL DEMO · NOT SHARED"}
        </div>
      </header>

      <div className="layout">
        <aside className="panel entry-panel">
          <div className="panel-topline">01 / ENTER THE BOWL</div>
          <h2>Choose your <em>marble.</em></h2>
          <p className="muted">Every entry becomes a marble. This beta uses simulated entries only.</p>

          <div className="design-picker">
            <button
              className="arrow"
              aria-label="Previous marble design"
              onClick={() => setDesignIndex((designIndex + DESIGNS.length - 1) % DESIGNS.length)}
              type="button"
            >‹</button>
            <div className="design-preview">
              <div className="big-marble" style={{ background: `radial-gradient(circle at 27% 23%, #ffffffd9, ${currentDesign.color} 45%, #13172e 130%)` }} />
              <strong>{currentDesign.label}</strong>
              <small>{designIndex + 1} / {DESIGNS.length}</small>
            </div>
            <button
              className="arrow"
              aria-label="Next marble design"
              onClick={() => setDesignIndex((designIndex + 1) % DESIGNS.length)}
              type="button"
            >›</button>
          </div>

          <label htmlFor="nickname">PLAYER NICKNAME</label>
          <input
            id="nickname"
            maxLength={18}
            placeholder="Your racer name"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && isLobby && !busy) void addMarble(); }}
          />
          <button
            className="primary-button"
            type="button"
            disabled={!isLobby || busy || room.entries.length >= room.maxPlayers}
            onClick={() => void addMarble()}
          >+ JOIN DEMO RACE</button>
          <p className="fine-print">No wallet · No actual MON · No payment is collected</p>

          <div className="divider" />
          <div className="small-title">RECENT ENTRIES <span>{room.entries.length}/{room.maxPlayers}</span></div>
          <div className="roster">
            {room.entries.length === 0 ? (
              <div className="empty-roster">The bowl is empty. Add the first marble!</div>
            ) : (
              room.entries.slice(-8).reverse().map((entry) => (
                <div className="roster-item" key={entry.id}>
                  <span className="mini-marble" style={{ background: DESIGNS[entry.design]?.color || "#b58aff" }} />
                  <span>{entry.nickname}</span>
                  <small>DEMO</small>
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="arena">
          <div className="arena-backdrop">
            {showingRace ? (
              <RaceScene entries={room.entries} roundId={room.roundId} frame={frame} autoFollow={autoFollow} />
            ) : (
              <BowlScene entries={room.entries} roundId={room.roundId} />
            )}
          </div>
          <div className="arena-heading">
            <span className="stage-label">{room.phase === "finished" ? "THE RACE HAS FINISHED" : room.phase === "racing" ? "THE RACE IS ON" : room.phase === "countdown" ? "GET READY TO DROP" : "THE WAITING BOWL"}</span>
            <span className="round-label">ROUND #{String(room.roundId).padStart(3, "0")}</span>
          </div>

          {room.phase === "countdown" && (
            <div className="countdown-overlay">
              <div className="countdown-number">{countdown || "GO!"}</div>
              <div>MARBLES, GET READY!</div>
            </div>
          )}

          <div className="bottom-hint">
            {showingRace
              ? autoFollow ? "SERVER PHYSICS · CAMERA FOLLOWS LEADERS" : "SERVER PHYSICS · DRAG TO ORBIT"
              : "MARBLES DROP AS PEOPLE JOIN · DRAG TO ORBIT"}
          </div>

          {showingRace && (
            <div className="winner-card">
              <small>FIRST TO FINISH · OFFICIAL SERVER RESULT</small>
              {winner ? (
                <strong><span style={{ background: DESIGNS[winner.design]?.color }} />{winner.nickname} wins!</strong>
              ) : room.phase === "finished" ? (
                <strong>No finisher · Race timed out</strong>
              ) : (
                <strong>Race in progress…</strong>
              )}
              <button className="camera-button" type="button" onClick={() => setAutoFollow((v) => !v)}>
                {autoFollow ? "Switch to free camera" : "Follow top 12 marbles"}
              </button>
              {leaders.length > 0 && (
                <div className="race-leaders">
                  <small>LIVE LEADERBOARD · SERVER RANKINGS</small>
                  {leaders.map((marble, index) => (
                    <div key={marble.id} className="leader-line">
                      <span>{index + 1}.</span>
                      <span className="mini-marble" style={{ background: DESIGNS[marble.player?.design ?? 0]?.color }} />
                      <span>{marble.player?.nickname || "Racer"}</span>
                      <span>{Math.round(marble.progress * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>

        <aside className="panel operator-panel">
          <div className="panel-topline">02 / RACE CONTROL</div>
          <h2>Make it <em>happen.</em></h2>
          <div className="numbers">
            <div><small>MARBLES</small><strong>{room.entries.length}</strong></div>
            <div><small>DEMO POOL</small><strong>{pool} <span>MON*</span></strong></div>
          </div>
          <div className="state-row">
            <span>STATUS</span>
            <strong>{room.phase === "lobby" ? "OPEN FOR ENTRIES" : room.phase === "countdown" ? "STARTING" : room.phase === "finished" ? "FINISHED" : "RACING"}</strong>
          </div>
          <p className="fine-print">*Illustrative testnet pool. No actual MON is deposited.</p>

          <label htmlFor="pin">OPERATOR PIN</label>
          <input
            id="pin"
            type="password"
            autoComplete="off"
            placeholder="Set OPERATOR_PIN on server"
            value={operatorPin}
            onChange={(event) => setOperatorPin(event.target.value)}
          />
          <button
            className="secondary-button"
            disabled={!isLobby || busy || room.entries.length >= room.maxPlayers}
            onClick={() => void operate(() => fill(operatorPin, 8), "Eight demo marbles requested.")}
          >+ ADD 8 DEMO MARBLES</button>
          <button
            className="primary-button"
            disabled={!isLobby || busy || room.entries.length < 2 || mode !== "shared"}
            onClick={() => void operate(() => start(operatorPin), "Race countdown started!")}
          >▶ START RACE</button>
          <button
            className="outline-button"
            disabled={busy}
            onClick={() => void operate(() => reset(operatorPin), "Lobby reset. Ready for the next round.")}
          >↻ RESET LOBBY</button>
          {notice && <p className="notice" role="status">{notice}</p>}

          <div className="divider" />
          <div className="small-title">BETA STATUS</div>
          <p className="muted explanation">
            {mode === "shared"
              ? "The Railway server calculates the official marble physics and broadcasts positions to all spectators."
              : hasServerUrl
                ? "The shared server is unreachable. Actions run locally until the connection is restored."
                : "No race-server URL is configured. This is a local-only demo."}
          </p>
          <p className="muted explanation">
            All browsers use the same authoritative race result. This is still a mock-entry demo, without blockchain payments or verified fairness.
          </p>
        </aside>
      </div>

      <footer className="footer">
        <span>MONAD MARBLES / HACKATHON PROTOTYPE</span>
        <span>TESTNET INTEGRATION COMING NEXT · NO REAL PRIZES</span>
      </footer>
    </div>
  );
}

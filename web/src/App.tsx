import { useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";
import BowlScene from "./components/BowlScene";
import RaceScene from "./components/RaceScene";
import { PaidEntryControls, PaidOperatorControls } from "./components/OnchainControls";
import { DESIGNS } from "./game";
import { useLobby } from "./hooks/useLobby";
import { countdownSeconds } from "./utils/countdown";
import { connectMetaMask, readContractOverview, contractAddress, type ContractOverview } from "./chain/monad";

export default function App() {
  const { room, frame, countdownAnchor, mode, hasServerUrl, join, verify, fill, start, reset } = useLobby();
  const [nickname, setNickname] = useState("");
  const [designIndex, setDesignIndex] = useState(0);
  const [operatorPin, setOperatorPin] = useState("");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [chainOverview, setChainOverview] = useState<ContractOverview | null>(null);
  const [chainMessage, setChainMessage] = useState("Checking Monad Testnet contract…");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const [clock, setClock] = useState(() => performance.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(performance.now()), 80);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setNotice("");
  }, [room.roundId]);

  async function refreshChain() {
    try {
      const state = await readContractOverview();
      setChainOverview(state);
      setChainMessage("");
    } catch (error) {
      setChainMessage(error instanceof Error ? error.message : "Unable to read contract.");
    }
  }

  useEffect(() => { void refreshChain(); }, []);

  async function connect() {
    try {
      const address = await connectMetaMask();
      setWalletAddress(address);
      setChainMessage("Wallet connected on Monad Testnet. Paid race entries are not enabled in this preview.");
      void refreshChain();
    } catch (error) {
      setChainMessage(error instanceof Error ? error.message : "Could not connect wallet.");
    }
  }

  const currentDesign = DESIGNS[designIndex];
  const onchain = room.blockchain?.mode === "onchain";
  const isLobby = room.phase === "lobby";
  const showingRace = room.phase === "racing" || room.phase === "finished";
  const pool = onchain && room.blockchain?.poolWei
    ? Number(formatEther(BigInt(room.blockchain.poolWei))).toFixed(2)
    : (room.entries.length * room.demoEntryFee).toFixed(1);
  const countdown = room.phase === "countdown" ? countdownSeconds(countdownAnchor, clock) : 0;
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
            <div className="eyebrow">MONAD BLITZ · BETA 4B · VERIFIED ENTRIES</div>
            <h1>MONAD <span>MARBLES</span></h1>
          </div>
        </div>
        <div className={"connection " + (mode === "shared" ? "online" : "offline")}>
          <span className="dot" />
          {mode === "shared" ? "LIVE · SHARED PHYSICS" : mode === "connecting" ? "RECONNECTING · RESULTS PAUSED" : "LOCAL DEMO · NOT SHARED"}
        </div>
      </header>

      <div className="layout">
        <aside className="panel entry-panel">
          <div className="panel-topline">01 / ENTER THE BOWL</div>
          <h2>Choose your <em>marble.</em></h2>
          <p className="muted">{onchain
            ? "Verified Monad Testnet transactions create marbles in the shared bowl."
            : "Every demo entry becomes a marble. No cryptocurrency is collected."}</p>

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
            disabled={onchain || !isLobby || busy || room.entries.length >= room.maxPlayers || (hasServerUrl && mode !== "shared")}
            onClick={() => void addMarble()}
          >+ JOIN DEMO RACE</button>
          <p className="fine-print">{onchain
            ? "Demo entries disabled while verified testnet registration is active."
            : "Demo entry only; this button does not send MON."}</p>

          <div className="wallet-onchain">
            <div className="wallet-onchain-title">MONAD TESTNET · CONTRACT</div>
            <div className="wallet-onchain-address">{contractAddress}</div>
            <button className="secondary-button" type="button" onClick={() => void connect()}>
              {walletAddress ? "CONNECTED: " + walletAddress.slice(0, 6) + "…" + walletAddress.slice(-4) : "CONNECT METAMASK"}
            </button>
            <div className="wallet-onchain-detail">
              <strong>{chainOverview?.status || "CHECKING CONTRACT"}</strong>
              {chainOverview?.activeRaceId && (
                <span>Race #{chainOverview.activeRaceId} · {chainOverview.entryCount}/{chainOverview.maxEntries} registered · {chainOverview.feeMON} testnet MON / entry</span>
              )}
              <small>{onchain
                ? "Verified payment entries are enabled. Winner settlement/claim is not automated yet."
                : "Wallet read-only preview. The server has not enabled blockchain payments."}</small>
            </div>
            {chainMessage && <p className="fine-print">{chainMessage}</p>}
            <button className="outline-button" type="button" onClick={() => void refreshChain()}>REFRESH CHAIN STATUS</button>
          </div>
          {onchain && (
            <PaidEntryControls room={room} walletAddress={walletAddress} nickname={nickname}
              design={designIndex} verify={verify} connected={mode === "shared"} />
          )}

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
                  <small>{entry.source === "chain" ? "TESTNET" : "DEMO"}</small>
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
            <span className="round-label">{onchain
              ? "CHAIN #" + (room.blockchain?.chainRaceId || "—")
              : "ROUND #" + String(room.roundId).padStart(3, "0")}
              {" · SESSION "}{room.sessionId?.slice(0, 8).toUpperCase() || "OFFLINE"}</span>
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
              {mode !== "shared" ? (
                <strong>Reconnecting to the official race server…</strong>
              ) : winner ? (
                <strong><span style={{ background: DESIGNS[winner.design]?.color }} />{winner.nickname} wins! <small>#{winner.id.slice(0, 8)}</small></strong>
              ) : room.phase === "finished" ? (
                <strong>No finisher · Race timed out</strong>
              ) : (
                <strong>Race in progress…</strong>
              )}
              <div className="official-race-id">RACE {room.raceId?.slice(0, 8).toUpperCase() || "PENDING"} · SERVER {room.sessionId?.slice(0, 8).toUpperCase() || "OFFLINE"}</div>
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
            <div><small>{onchain ? "ON-CHAIN POOL" : "DEMO POOL"}</small><strong>{pool} <span>MON*</span></strong></div>
          </div>
          <div className="state-row">
            <span>STATUS</span>
            <strong>{room.phase === "lobby" ? "OPEN FOR ENTRIES" : room.phase === "countdown" ? "STARTING" : room.phase === "finished" ? "FINISHED" : room.phase === "interrupted" ? "RECOVERY LOCKED" : room.phase === "waiting" ? "AWAITING ON-CHAIN RACE" : "RACING"}</strong>
          </div>
          <p className="fine-print">{onchain
            ? "*Actual testnet MON escrow. Winner payout requires on-chain finalization; cancel/refund if interrupted."
            : "*Illustrative testnet pool. No actual MON is deposited."}</p>

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
            disabled={onchain || !isLobby || busy || room.entries.length >= room.maxPlayers || (hasServerUrl && mode !== "shared")}
            onClick={() => void operate(() => fill(operatorPin, 8), "Eight demo marbles requested.")}
          >+ ADD 8 DEMO MARBLES</button>
          <button
            className="primary-button"
            disabled={onchain || !isLobby || busy || room.entries.length < 2 || mode !== "shared"}
            onClick={() => void operate(() => start(operatorPin), "Race countdown started!")}
          >▶ START RACE</button>
          <button
            className="outline-button"
            disabled={onchain || busy || (hasServerUrl && mode !== "shared")}
            onClick={() => void operate(() => reset(operatorPin), "Lobby reset. Ready for the next round.")}
          >↻ RESET LOBBY</button>
          {onchain && <PaidOperatorControls room={room} walletAddress={walletAddress} operatorPin={operatorPin}
            start={start} connected={mode === "shared"} />}
          {notice && <p className="notice" role="status">{notice}</p>}

          <div className="divider" />
          <div className="small-title">BETA STATUS</div>
          <p className="muted explanation">
            {mode === "shared"
              ? "The Railway server calculates the official marble physics and broadcasts positions to all spectators."
              : hasServerUrl
                ? "The shared server is unreachable. Race controls are paused until reconnection."
                : "No race-server URL is configured. This is a local-only demo."}
          </p>
          <p className="muted explanation">
            {onchain
              ? "Only confirmed on-chain entrants get marbles. Manual 10-second countdown remains unchanged. Settlement is not automated yet."
              : "All browsers use the same authoritative race result. Demo entries are simulated."}
          </p>
        </aside>
      </div>

      <footer className="footer">
        <span>MONAD MARBLES / HACKATHON PROTOTYPE</span>
        <span>{onchain ? "TESTNET MON ENTRIES · PAYOUTS REQUIRE SETTLEMENT" : "DEMO MODE · NO PAYMENT REQUIRED"}</span>
      </footer>
    </div>
  );
}

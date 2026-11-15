import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { DESIGNS, newLocalRoom, type Entry, type Result, type RoomState, type RaceFrame } from "../game";

type Mode = "connecting" | "shared" | "local";
type Action = "lobby:join" | "lobby:fill" | "lobby:start" | "lobby:reset" | "lobby:verify";
type Payload = { nickname?: string; design?: number; count?: number; pin?: string; raceId?: string; txHash?: string; signature?: string };

const configuredUrl = (import.meta.env.VITE_RACE_SERVER_URL as string | undefined)?.trim();
const serverUrl = configuredUrl || (import.meta.env.DEV ? "http://localhost:3001" : "");

export function useLobby() {
  const [room, setRoom] = useState<RoomState>(() => newLocalRoom());
  const [frame, setFrame] = useState<RaceFrame | null>(null);
  const [countdownAnchor, setCountdownAnchor] = useState<{ remainingMs: number; receivedAt: number } | null>(null);
  const [mode, setMode] = useState<Mode>(serverUrl ? "connecting" : "local");
  const socketRef = useRef<Socket | null>(null);
  const roomRef = useRef(room);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    if (!serverUrl) return;
    const socket = io(serverUrl, {
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      // Wait for a fresh server snapshot before showing any previous result.
      setMode("connecting");
      setFrame(null);
      setCountdownAnchor(null);
    });
    socket.on("disconnect", () => {
      setMode("connecting");
      setFrame(null);
      setCountdownAnchor(null);
    });
    socket.on("connect_error", () => setMode("connecting"));
    socket.on("lobby:state", (next: RoomState) => {
      const old = roomRef.current;
      if (next.roundId !== old.roundId || next.sessionId !== old.sessionId || next.raceId !== old.raceId) {
        setFrame(null);
      }
      // Uses time remaining at the server, anchored to monotonic browser time.
      // A laptop's inaccurate wall clock therefore cannot shift the countdown.
      if (next.phase === "countdown" && next.startsAt !== null && typeof next.serverTime === "number") {
        setCountdownAnchor({
          remainingMs: Math.max(0, next.startsAt - next.serverTime),
          receivedAt: performance.now(),
        });
      } else {
        setCountdownAnchor(null);
      }
      roomRef.current = next;
      setRoom(next);
      setMode("shared");
    });
    socket.on("race:snapshot", (next: RaceFrame) => {
      if (next.roundId !== roomRef.current.roundId ||
          next.sessionId !== roomRef.current.sessionId ||
          next.raceId !== roomRef.current.raceId) return;
      setFrame((old) => old && old.roundId === next.roundId &&
        old.sessionId === next.sessionId && old.raceId === next.raceId &&
        old.tick > next.tick ? old : next);
    });
    socket.on("race:error", (message: string) => {
      console.error("Shared race error:", message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const updateLocal = useCallback((next: RoomState) => {
    roomRef.current = next;
    setRoom(next);
  }, []);

  const action = useCallback(async (event: Action, payload: Payload = {}): Promise<Result> => {
    const socket = socketRef.current;
    if (socket?.connected) {
      try {
        const result = await socket.timeout(event === "lobby:start" ? 145000 : 4500).emitWithAck(event, payload) as Result;
        return result || { ok: false, error: "No response from server." };
      } catch {
        return { ok: false, error: "The server did not respond. Try again." };
      }
    }

    if (serverUrl) return { ok: false, error: "Disconnected from the shared server. Reconnect before continuing." };

    const current = roomRef.current;
    if (event === "lobby:join") {
      if (current.phase !== "lobby") return { ok: false, error: "Registration has closed." };
      if (current.entries.length >= current.maxPlayers) return { ok: false, error: "The bowl is full." };
      const nickname = (payload.nickname || "").replace(/[<>]/g, "").trim().slice(0, 18);
      if (!nickname) return { ok: false, error: "Please enter a nickname." };
      const design = Number(payload.design);
      if (!Number.isInteger(design) || design < 0 || design >= DESIGNS.length) {
        return { ok: false, error: "Choose a valid marble." };
      }
      const entry: Entry = {
        id: "local-" + Math.random().toString(36).slice(2),
        nickname, design, joinedAt: Date.now(), source: "demo",
      };
      updateLocal({ ...current, entries: [...current.entries, entry] });
      return { ok: true };
    }

    if (event === "lobby:fill") {
      if (current.phase !== "lobby") return { ok: false, error: "Registration has closed." };
      const count = Math.min(12, Math.max(1, Number(payload.count) || 8));
      const entries = [...current.entries];
      for (let i = 0; i < count && entries.length < current.maxPlayers; i++) {
        const n = entries.length + 1;
        entries.push({
          id: "local-" + Math.random().toString(36).slice(2),
          nickname: "Guest " + String(n).padStart(2, "0"),
          design: (n - 1) % DESIGNS.length,
          joinedAt: Date.now(), source: "demo",
        });
      }
      updateLocal({ ...current, entries });
      return { ok: true };
    }

    if (event === "lobby:start") {
      return { ok: false, error: "The shared race server must be online to start an official race." };
    }

    if (event === "lobby:reset") {
      setFrame(null);
      setCountdownAnchor(null);
      updateLocal(newLocalRoom(current.roundId + 1));
      return { ok: true };
    }

    return { ok: false, error: "Unknown command." };
  }, [updateLocal]);

  return {
    room,
    frame,
    countdownAnchor,
    mode,
    hasServerUrl: Boolean(serverUrl),
    join: (nickname: string, design: number) => action("lobby:join", { nickname, design }),
    verify: (payload: { raceId: string; txHash: string; nickname: string; signature: string }) =>
      action("lobby:verify", payload),
    fill: (pin: string, count = 8) => action("lobby:fill", { pin, count }),
    start: (pin: string) => action("lobby:start", { pin }),
    reset: (pin: string) => action("lobby:reset", { pin }),
  };
}

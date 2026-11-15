export const DESIGNS = [
  { label: "Bubblegum", color: "#ff79b8" },
  { label: "Tangerine", color: "#ffad55" },
  { label: "Lemon Drop", color: "#ffe66d" },
  { label: "Mint Chip", color: "#74e5bc" },
  { label: "Blueberry", color: "#648fff" },
  { label: "Grape Soda", color: "#b58aff" },
  { label: "Cherry Pop", color: "#ff657b" },
  { label: "Lime Rush", color: "#b6ef5c" },
  { label: "Peachy", color: "#ffc39f" },
  { label: "Cotton Candy", color: "#ef9eff" },
  { label: "Sky Splash", color: "#7fdef8" },
  { label: "Midnight", color: "#404c9d" },
  { label: "Galaxy", color: "#8a60de" },
  { label: "Golden", color: "#f9cc5b" },
] as const;

export type Phase = "lobby" | "countdown" | "racing" | "finished";

export interface Entry {
  id: string;
  nickname: string;
  design: number;
  joinedAt: number;
  source: "demo";
}

export interface RoomState {
  roundId: number;
  raceId?: string;
  sessionId?: string;
  phase: Phase;
  startsAt: number | null;
  entries: Entry[];
  maxPlayers: number;
  demoEntryFee: number;
  demoOnly: boolean;
  authoritativePhysics?: boolean;
  winnerId?: string | null;
  finishOrder?: string[];
  serverTime?: number;
}

export interface MarbleFrame {
  id: string;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  progress: number;
}

export interface RaceFrame {
  roundId: number;
  raceId?: string;
  sessionId?: string;
  tick: number;
  elapsed: number;
  winnerId: string | null;
  marbles: MarbleFrame[];
}

export interface Result {
  ok: boolean;
  error?: string;
  entryId?: string;
}

export function newLocalRoom(roundId = 1): RoomState {
  return {
    roundId,
    phase: "lobby",
    startsAt: null,
    entries: [],
    maxPlayers: 48,
    demoEntryFee: 0.1,
    demoOnly: true,
    authoritativePhysics: false,
    winnerId: null,
    finishOrder: [],
  };
}

export const DESIGNS = [
  { label: "Violet", color: "#b58aff" },
  { label: "Tangerine", color: "#ffb15e" },
  { label: "Aqua", color: "#6cddf5" },
  { label: "Rose", color: "#fa729a" },
  { label: "Lime", color: "#c5ee72" },
  { label: "Gold", color: "#ffe28b" },
  { label: "Blue", color: "#748eff" },
  { label: "Mint", color: "#70e6bb" },
] as const;

export type Phase = "waiting" | "interrupted" | "lobby" | "countdown" | "racing" | "finished";

export interface Entry {
  id: string;
  nickname: string;
  design: number;
  joinedAt: number;
  source: "demo" | "chain";
  wallet?: string;
  entryId?: string;
  txHash?: string;
  eventKey?: string;
}

export interface ChainStatus {
  mode: "onchain";
  status: "loading" | "open" | "closed" | "interrupted" | "blocked" | "waiting" | "error";
  chainRaceId: string | null;
  entryFeeWei: string | null;
  poolWei: string | null;
  entryCount: number;
  capacity: number;
  registered?: number;
  synced: boolean;
  canStart: boolean;
  message: string;
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
  chainRaceId?: string | null;
  blockchain?: ChainStatus | null;
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

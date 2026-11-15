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

export type Phase = "lobby" | "countdown" | "racing";

export interface Entry {
  id: string;
  nickname: string;
  design: number;
  joinedAt: number;
  source: "demo";
}

export interface RoomState {
  roundId: number;
  phase: Phase;
  startsAt: number | null;
  entries: Entry[];
  maxPlayers: number;
  demoEntryFee: number;
  demoOnly: boolean;
  serverTime?: number;
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
  };
}

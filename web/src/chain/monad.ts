import { createPublicClient, defineChain, formatEther, http, parseAbi } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" } },
  testnet: true,
});

export const contractAddress = (
  (import.meta.env.VITE_MONAD_MARBLES_ADDRESS as string | undefined)?.trim() ||
  "0x9fB46e07dFcEad9B51799aD4B5A5b8a2c254c55B"
) as `0x${string}`;

const contractABI = parseAbi([
  "function owner() view returns (address)",
  "function activeRaceId() view returns (uint256)",
  "function nextRaceId() view returns (uint256)",
  "function races(uint256) view returns (uint8 status, uint256 entryFee, uint256 prizePool, uint256 winningEntryId, uint64 createdAt, uint64 closedAt, uint16 maxEntries, uint16 entryCount, bool prizeClaimed)",
]);

const client = createPublicClient({ chain: monadTestnet, transport: http() });

export type ContractOverview = {
  owner: string;
  activeRaceId: string | null;
  nextRaceId: string;
  feeMON: string | null;
  poolMON: string | null;
  entryCount: number | null;
  maxEntries: number | null;
  status: string;
};

export async function readContractOverview(): Promise<ContractOverview> {
  const bytecode = await client.getBytecode({ address: contractAddress });
  if (!bytecode || bytecode === "0x") throw new Error("No contract bytecode found at the configured address.");

  const [owner, activeId, nextId] = await Promise.all([
    client.readContract({ address: contractAddress, abi: contractABI, functionName: "owner" }),
    client.readContract({ address: contractAddress, abi: contractABI, functionName: "activeRaceId" }),
    client.readContract({ address: contractAddress, abi: contractABI, functionName: "nextRaceId" }),
  ]);

  if (activeId === 0n) {
    return { owner, activeRaceId: null, nextRaceId: nextId.toString(), feeMON: null, poolMON: null, entryCount: null, maxEntries: null, status: "NO ACTIVE RACE" };
  }

  const race = await client.readContract({ address: contractAddress, abi: contractABI, functionName: "races", args: [activeId] });
  const [status, entryFee, prizePool, , , , maxEntries, entryCount] = race;
  const phases = ["NOT CREATED", "OPEN", "CLOSED", "FINALIZED", "CANCELED"];

  return {
    owner,
    activeRaceId: activeId.toString(),
    nextRaceId: nextId.toString(),
    feeMON: formatEther(entryFee),
    poolMON: formatEther(prizePool),
    entryCount,
    maxEntries,
    status: phases[status] || "UNKNOWN",
  };
}

type EthereumProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

export function injectedWallet(): EthereumProvider | null {
  return (window as Window & { ethereum?: EthereumProvider }).ethereum || null;
}

export async function connectMetaMask(): Promise<string> {
  const wallet = injectedWallet();
  if (!wallet) throw new Error("No browser wallet detected. Install MetaMask, then refresh.");
  const accounts = await wallet.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("The wallet did not provide an address.");
  }

  const chainId = await wallet.request({ method: "eth_chainId" });
  if (chainId !== "0x279f" && Number(chainId) !== 10143) {
    try {
      await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x279f" }] });
    } catch (error) {
      if ((error as { code?: number })?.code !== 4902) throw error;
      await wallet.request({ method: "wallet_addEthereumChain", params: [{
        chainId: "0x279f",
        chainName: "Monad Testnet",
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: ["https://testnet-rpc.monad.xyz"],
        blockExplorerUrls: ["https://testnet.monadexplorer.com"],
      }] });
    }
  }

  return accounts[0];
}

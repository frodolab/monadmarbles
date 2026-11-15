import { createPublicClient, defineChain, encodeFunctionData, formatEther, http, parseAbi, parseEther, toHex } from "viem";

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
  "function createRace(uint256 entryFee, uint16 maxEntries) returns (uint256)",
  "function joinRace(uint256 raceId, uint8 design) payable returns (uint256)",
  "function closeEntries(uint256 raceId)",
  "function cancelRace(uint256 raceId)",
  "function claimRefund(uint256 raceId)",
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


// Wallet transactions are available only when the backend advertises
// opt-in paid admission. They are NOT called by the demo-only production UI.
function validWalletAddress(account: string): account is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(account);
}

async function sendContractTransaction({
  walletAddress, data, value,
}: {
  walletAddress: string;
  data: `0x${string}`;
  value?: bigint;
}): Promise<`0x${string}`> {
  const provider = injectedWallet();
  if (!provider) throw new Error("MetaMask is required to send a testnet transaction.");
  if (!validWalletAddress(walletAddress)) throw new Error("Connect a valid wallet first.");
  const chainId = Number(await provider.request({ method: "eth_chainId" }));
  if (chainId !== monadTestnet.id) throw new Error("Switch MetaMask to Monad Testnet (10143).");
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || !accounts.some(x => typeof x === "string" && x.toLowerCase() === walletAddress.toLowerCase())) {
    throw new Error("The connected MetaMask account changed. Please reconnect.");
  }
  const request: Record<string, string> = {
    from: walletAddress,
    to: contractAddress,
    data,
  };
  if (value !== undefined) request.value = toHex(value);
  const hash = await provider.request({ method: "eth_sendTransaction", params: [request] });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error("MetaMask did not return a valid transaction hash.");
  }
  return hash as `0x${string}`;
}

export async function waitForTestnetTransaction(hash: `0x${string}`) {
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("The transaction reverted on Monad Testnet.");
  return receipt;
}

export function entryNicknameMessage({
  raceId, transactionHash, nickname,
}: {
  raceId: string;
  transactionHash: string;
  nickname: string;
}) {
  return [
    "Monad Marbles Testnet Registration",
    "Chain: 10143",
    "Contract: " + contractAddress.toLowerCase(),
    "Race: " + BigInt(raceId).toString(),
    "Transaction: " + transactionHash.toLowerCase(),
    "Nickname: " + nickname.trim(),
    "I authorize this nickname to be associated with my verified race entry.",
  ].join("\n");
}

export async function signEntryNickname({
  walletAddress, raceId, transactionHash, nickname,
}: {
  walletAddress: string;
  raceId: string;
  transactionHash: string;
  nickname: string;
}) {
  const provider = injectedWallet();
  if (!provider) throw new Error("Connect MetaMask to sign your nickname.");
  if (!validWalletAddress(walletAddress)) throw new Error("Connect a valid wallet first.");
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) ||
      !accounts.some(x => typeof x === "string" && x.toLowerCase() === walletAddress.toLowerCase())) {
    throw new Error("Switch back to the wallet that paid for this marble.");
  }
  const message = entryNicknameMessage({ raceId, transactionHash, nickname });
  const signature = await provider.request({
    method: "personal_sign",
    params: [toHex(message), walletAddress],
  });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error("MetaMask returned an invalid nickname signature.");
  }
  return signature;
}

export async function submitRaceEntry(walletAddress: string, raceId: string, design: number, feeWei: string) {
  if (!Number.isInteger(design) || design < 0 || design >= 14) throw new Error("Invalid marble design.");
  const value = BigInt(feeWei);
  if (value <= 0n) throw new Error("The on-chain entry fee is unavailable.");
  const data = encodeFunctionData({
    abi: contractABI, functionName: "joinRace", args: [BigInt(raceId), design],
  });
  return sendContractTransaction({ walletAddress, data, value });
}

export async function closeRaceEntries(walletAddress: string, raceId: string) {
  const data = encodeFunctionData({
    abi: contractABI, functionName: "closeEntries", args: [BigInt(raceId)],
  });
  return sendContractTransaction({ walletAddress, data });
}

export async function createTestnetRace(walletAddress: string, entryFeeMON = "0.1", capacity = 48) {
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 48) throw new Error("Invalid race capacity.");
  const data = encodeFunctionData({
    abi: contractABI, functionName: "createRace", args: [parseEther(entryFeeMON), capacity],
  });
  return sendContractTransaction({ walletAddress, data });
}

export const testnetExplorerTx = (txHash: string) =>
  "https://testnet.monadexplorer.com/tx/" + txHash;

export async function cancelTestnetRace(walletAddress: string, raceId: string) {
  const data = encodeFunctionData({
    abi: contractABI, functionName: "cancelRace", args: [BigInt(raceId)],
  });
  return sendContractTransaction({ walletAddress, data });
}

export async function claimTestnetRefund(walletAddress: string, raceId: string) {
  const data = encodeFunctionData({
    abi: contractABI, functionName: "claimRefund", args: [BigInt(raceId)],
  });
  return sendContractTransaction({ walletAddress, data });
}

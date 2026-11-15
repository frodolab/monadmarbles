import {
  createPublicClient, defineChain, encodeFunctionData, formatEther,
  http, parseAbi, parseEther, toHex,
} from 'viem';

// Exactly the V2 ABI already used by web/src/chain/monad.ts.
// This module never receives a private key. Wallet owners sign in MetaMask,
// while the existing authorized Railway settler handles prize settlement.
const abi = parseAbi([
  'function createRace(uint256 entryFee, uint16 maxEntries) returns (uint256)',
  'function joinRace(uint256 raceId, uint8 design) payable returns (uint256)',
  'function cancelRace(uint256 raceId)',
  'function claimRefund(uint256 raceId)',
  'function owner() view returns (address)',
]);
const chain = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' } },
  testnet: true,
});
const rpcUrl = import.meta.env.VITE_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 2, timeout: 18000 }) });
const pinnedContract = String(import.meta.env.VITE_MONAD_MARBLES_ADDRESS || '').trim().toLowerCase();
const pendingKey = 'monad-marbles-v27-pending-paid-entry-v1';
const txRegex = /^0x[0-9a-fA-F]{64}$/;
const addressRegex = /^0x[0-9a-fA-F]{40}$/;

export const testnetExplorerTx = hash =>
  txRegex.test(String(hash || '')) ? 'https://testnet.monadexplorer.com/tx/' + hash : null;

export function formatWei(wei, digits = 4) {
  try {
    if (wei === null || wei === undefined || !/^\d+$/.test(String(wei))) return '?';
    const stringValue = formatEther(BigInt(wei));
    const [integer, fraction = ''] = stringValue.split('.');
    const trimmed = fraction.slice(0, digits).replace(/0+$/, '');
    return trimmed ? integer + '.' + trimmed : integer;
  } catch { return '?'; }
}

export function validateOnchainRoom(room, forJoin = false) {
  if (!room || room.demoOnly !== false || room.blockchain?.mode !== 'onchain') {
    throw new Error('This room is in FREE preview mode, not paid Monad Testnet mode.');
  }
  if (room.course !== 'v27') throw new Error('Backend must run authoritative V27 physics.');
  const b = room.blockchain;
  if (Number(b.chainId) !== 10143) throw new Error('Backend chain is not Monad Testnet (10143).');
  const contract = String(b.contractAddress || '').toLowerCase();
  if (!addressRegex.test(contract)) throw new Error('Backend has not advertised a valid V2 contract.');
  if (!addressRegex.test(pinnedContract) || contract !== pinnedContract) {
    throw new Error('Frontend V2 contract is not pinned to the same address as the backend. Payments are locked.');
  }
  if (!b.autoPayoutEnabled) {
    throw new Error('Automatic settlement is disabled on this backend. Payments are locked.');
  }
  if (forJoin) {
    if (room.phase !== 'lobby' || b.status !== 'open' || !b.synced) {
      throw new Error('The on-chain race is not open and fully synchronized.');
    }
    if (!/^\d+$/.test(String(b.chainRaceId || '')) ||
        !/^\d+$/.test(String(b.entryFeeWei || '')) || BigInt(b.entryFeeWei) <= 0n) {
      throw new Error('The active race ID or payment amount is invalid.');
    }
    if (room.entries.length >= room.maxPlayers || room.entries.length >= b.capacity) {
      throw new Error('This on-chain race is already full.');
    }
  }
  return contract;
}

function readPending() {
  try {
    const obj = JSON.parse(localStorage.getItem(pendingKey) || 'null');
    if (!obj || !txRegex.test(obj.txHash) || !addressRegex.test(obj.wallet) ||
        !addressRegex.test(obj.contract) || !/^\d+$/.test(String(obj.raceId))) return null;
    return obj;
  } catch { return null; }
}

function savePending(item) {
  try {
    if (!item) localStorage.removeItem(pendingKey);
    else localStorage.setItem(pendingKey, JSON.stringify(item));
  } catch {
    // The current session still tracks the pending transaction.
  }
}

export function createPaidIntegration({ getRoom, getWallet, getProvider, notify, onChanged }) {
  let pending = readPending();
  let operation = null;
  const update = () => onChanged?.();

  function activePending() {
    return pending;
  }
  function matchesPending(room = getRoom()) {
    const wallet = getWallet();
    return Boolean(pending && wallet &&
      pending.contract.toLowerCase() === pinnedContract &&
      pending.wallet.toLowerCase() === wallet.toLowerCase() &&
      pending.raceId === String(room?.blockchain?.chainRaceId || ''));
  }
  function refreshFromRoom(room) {
    if (!pending || !Array.isArray(room?.entries)) return;
    if (room.entries.some(entry => entry.source === 'chain' &&
        entry.txHash?.toLowerCase() === pending.txHash.toLowerCase() &&
        entry.wallet?.toLowerCase() === pending.wallet.toLowerCase())) {
      pending = null;
      savePending(null);
      notify('On-chain payment verified; your marble is officially registered.');
      update();
    }
  }

  async function send(method, args, value = undefined, forJoin = false) {
    const room = getRoom();
    const contract = validateOnchainRoom(room, forJoin);
    const provider = getProvider();
    const wallet = getWallet();
    if (!provider?.request || !wallet || !addressRegex.test(wallet)) {
      throw new Error('Connect the paying MetaMask wallet first.');
    }
    const chainId = await provider.request({ method: 'eth_chainId' });
    if (BigInt(chainId) !== 10143n) throw new Error('Switch MetaMask to Monad Testnet before paying.');
    const connected = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(connected) ||
        !connected.some(x => String(x).toLowerCase() === wallet.toLowerCase())) {
      throw new Error('MetaMask account changed. Reconnect before submitting.');
    }
    const data = encodeFunctionData({ abi, functionName: method, args });
    const tx = { from: wallet, to: contract, data };
    if (value !== undefined) tx.value = toHex(value);
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
    if (!txRegex.test(String(hash))) throw new Error('MetaMask did not return a valid transaction hash.');
    return hash;
  }

  async function wait(hash) {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash, confirmations: 2, timeout: 120000,
    });
    if (receipt.status !== 'success') throw new Error('The transaction reverted on Monad Testnet.');
    return receipt;
  }

  async function run(type, fn) {
    if (operation) throw new Error('Another wallet transaction is being processed: ' + operation);
    operation = type; update();
    try { return await fn(); }
    finally { operation = null; update(); }
  }

  async function join(design) {
    return run('join', async () => {
      const room = getRoom();
      const contract = validateOnchainRoom(room, true);
      const wallet = getWallet();
      if (!wallet) throw new Error('Connect MetaMask first.');
      if (matchesPending()) {
        throw new Error('You already have an entry transaction pending for this race. Do not pay twice; use Check Payment.');
      }
      if (room.entries.some(entry => entry.source === 'chain' &&
        entry.wallet?.toLowerCase() === wallet.toLowerCase())) {
        throw new Error('This wallet is already registered for this race.');
      }
      if (!Number.isInteger(design) || design < 0 || design >= 14) {
        throw new Error('Choose a valid marble design.');
      }
      const b = room.blockchain;
      const feeWei = BigInt(b.entryFeeWei);
      // Confirmed blockchain events, never the client, decide admission.
      // Save the tx hash before waiting, so reloads cannot cause double payments.
      const hash = await send('joinRace', [BigInt(b.chainRaceId), design], feeWei, true);
      pending = { txHash: hash, wallet, contract, raceId: String(b.chainRaceId), design, createdAt: Date.now() };
      savePending(pending); update();
      notify('Entry submitted (' + formatWei(b.entryFeeWei) + ' MON). Waiting for confirmations — do not pay again.');
      await wait(hash);
      notify('Payment confirmed on Monad Testnet. Waiting for the race server to verify your entry.');
      refreshFromRoom(getRoom());
      return hash;
    });
  }

  async function checkPayment() {
    if (!pending) throw new Error('No saved pending payment.');
    return run('check payment', async () => {
      const hash = pending.txHash;
      const receipt = await wait(hash);
      notify('Transaction confirmed. Waiting for server admission; do not resubmit a payment.');
      refreshFromRoom(getRoom());
      return receipt.transactionHash;
    });
  }

  async function createRace() {
    return run('create race', async () => {
      const room = getRoom();
      validateOnchainRoom(room);
      if (room.blockchain.status !== 'waiting') throw new Error('A contract race is still active.');
      const hash = await send('createRace', [parseEther('0.1'), 48]);
      notify('Creating a 0.1 MON, 48-slot V2 contract race: ' + hash);
      await wait(hash);
      notify('Race created on Monad Testnet. Waiting for the backend to recognize it.');
      return hash;
    });
  }

  async function cancelRace() {
    return run('cancel race', async () => {
      const room = getRoom();
      validateOnchainRoom(room);
      const raceId = room.blockchain.chainRaceId;
      if (!/^\d+$/.test(String(raceId || ''))) throw new Error('No active on-chain race to cancel.');
      const hash = await send('cancelRace', [BigInt(raceId)]);
      notify('Cancellation submitted: ' + hash);
      await wait(hash);
      notify('On-chain race canceled. Each paid wallet can request its own refund.');
      return hash;
    });
  }

  async function claimRefund(raceId) {
    return run('claim refund', async () => {
      validateOnchainRoom(getRoom());
      if (!/^[1-9]\d*$/.test(String(raceId))) throw new Error('Enter a valid canceled race ID.');
      const hash = await send('claimRefund', [BigInt(raceId)]);
      notify('Refund claim submitted: ' + hash);
      await wait(hash);
      notify('Refund transaction confirmed: ' + hash);
      return hash;
    });
  }

  return {
    get busy() { return Boolean(operation); },
    get operation() { return operation; },
    get pending() { return activePending(); },
    matchesPending, refreshFromRoom, join, checkPayment, createRace, cancelRace, claimRefund,
  };
}

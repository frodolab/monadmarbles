import { io } from 'socket.io-client';

const serverUrl = import.meta.env.VITE_RACE_SERVER_URL?.trim();
const stage = document.querySelector('.stage');
const status = document.createElement('div');
status.id = 'livePreviewStatus';
status.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:400;background:#252054e8;color:white;border:1px solid #a399ef;border-radius:12px;padding:9px 14px;font:700 12px Nunito,sans-serif;max-width:360px';
status.textContent = 'V27 SANDBOX · Connecting to shared race server…';
document.body.append(status);

if (!serverUrl) {
  status.textContent = 'V27 SANDBOX · VITE_RACE_SERVER_URL missing';
  throw new Error('VITE_RACE_SERVER_URL missing');
}
const socket = io(serverUrl, { reconnection: true, reconnectionDelay: 800, reconnectionDelayMax: 5000 });
let room = null;
let wallet = null;
let waitingToJoin = false;
const short = (value) => value.slice(0, 6) + '…' + value.slice(-4);
const ui = window.MonadMarblesPreviewBridge;
if (!ui) throw new Error('V27 preview adapter did not initialize');

const ack = async (event, payload, timeout = 7000) => {
  if (!socket.connected) throw new Error('Race server is disconnected');
  const response = await socket.timeout(timeout).emitWithAck(event, payload);
  if (!response?.ok) throw new Error(response?.error || 'Action was rejected');
  return response;
};
const notify = (message) => {
  ui.toast(message);
  status.textContent = 'V27 SANDBOX · ' + message;
};
const hasEntry = () => Boolean(room?.entries?.some(entry =>
  entry.wallet?.toLowerCase() === wallet?.toLowerCase() ||
  (entry.nickname === short(wallet || '0x0000000000000000000000000000000000000000'))));
// EIP-1193 single-flight: one wallet permission request at a time.
// eth_accounts is silent; only eth_requestAccounts opens a new approval prompt.
const getMetaMaskProvider = () => {
  const injected = window.ethereum;
  const candidates = Array.isArray(injected?.providers) ? injected.providers : [injected];
  return candidates.find(candidate => candidate?.isMetaMask) || injected;
};
let connectInFlight = null;
const connectWallet = async () => {
  if (connectInFlight) return connectInFlight;
  const provider = getMetaMaskProvider();
  if (!provider?.request) throw new Error('Install or enable MetaMask to join this preview');
  connectInFlight = (async () => {
    let accounts = await provider.request({ method: 'eth_accounts' });
    if (!accounts?.[0]) {
      accounts = await provider.request({ method: 'eth_requestAccounts' });
    }
    if (!accounts?.[0]) throw new Error('No MetaMask account was returned');
    const chainId = await provider.request({ method: 'eth_chainId' });
    if (Number(BigInt(chainId)) !== 10143) {
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x279f' }] });
      } catch (error) {
        if (error?.code !== 4902) throw error;
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: '0x279f', chainName: 'Monad Testnet', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: ['https://testnet-rpc.monad.xyz'], blockExplorerUrls: ['https://testnet.monadexplorer.com'] }],
        });
      }
    }
    wallet = accounts[0];
    ui.setWallet(wallet);
    notify('MetaMask connected · ' + short(wallet));
    ui.applyRoom(room, wallet);
    return wallet;
  })();
  try {
    return await connectInFlight;
  } catch (error) {
    if (Number(error?.code) === -32002) {
      throw new Error('MetaMask already has a pending request for this site. Open the MetaMask extension and approve or reject that existing request, then retry.');
    }
    throw error;
  } finally {
    connectInFlight = null;
  }
};
getMetaMaskProvider()?.on?.('accountsChanged', accounts => {
  wallet = accounts?.[0] || null;
  ui.setWallet(wallet);
  ui.applyRoom(room, wallet);
});
getMetaMaskProvider()?.on?.('chainChanged', () => notify('Wallet network changed; switch to Monad Testnet'));

const join = async () => {
  if (waitingToJoin) return;
  waitingToJoin = true;
  try {
    if (!wallet) await connectWallet();
    if (hasEntry()) return notify('Your marble is already registered');
    if (room?.phase !== 'lobby') throw new Error('Registration is not open');
    const nickname = short(wallet);
    const design = ui.getSelectedDesign();
    await ack('lobby:join', { nickname, design });
    notify('Preview entry registered · no MON transferred');
  } catch (error) { notify(error.message || 'Unable to join'); }
  finally { waitingToJoin = false; }
};

ui.connected = false;
ui.verifyOperatorPin = async pin => {
  await ack('operator:verify', { pin });
  return true;
};
ui.join = join;
ui.fill = async (pin, count) => {
  try { await ack('lobby:fill', { pin, count }); notify('Added demo racers'); return true; }
  catch (error) { notify(error.message); return false; }
};
ui.start = async pin => {
  try {
    await ack('lobby:start', { pin }, 145000);
    notify('Server accepted start · synchronized ten-second countdown');
    return true;
  } catch (error) { notify(error.message); return false; }
};
ui.reset = async pin => {
  try { await ack('lobby:reset', { pin }); return true; }
  catch (error) { notify(error.message); return false; }
};
ui.connectWallet = connectWallet;

document.querySelectorAll('[data-wallet]').forEach(button => {
  if (button.dataset.wallet !== 'MetaMask') button.style.display = 'none';
  else button.onclick = async () => {
    try { await connectWallet(); document.getElementById('walletModal').classList.remove('open'); }
    catch (error) { notify(error.message); }
  };
});
const walletTitle = document.querySelector('#walletTitle');
if (walletTitle) walletTitle.textContent = 'CONNECT METAMASK · PREVIEW';
const disclaimer = document.querySelector('.wallet-disclaimer');
if (disclaimer) disclaimer.textContent = 'SANDBOX · CONNECT REAL METAMASK · NO ENTRY TRANSACTION';
document.querySelector('.footer').textContent = 'V27 INTEGRATION SANDBOX · SHARED SERVER · NO ON-CHAIN ENTRY OR PAYOUT';
document.querySelector('.mock-note').textContent = 'FREE SANDBOX';
document.getElementById('join').textContent = '✦ CONNECT & JOIN PREVIEW ✦';
document.getElementById('join').onclick = join;
const start = document.getElementById('start');
start.textContent = '▶ START RACE';
start.onclick = async () => {
  const pin = ui.getOperatorPin();
  if (!pin) { document.getElementById('devAccess').click(); return; }
  await ui.start(pin);
};
for (const [id, count] of [['addOne', 1], ['addTen', 10]]) {
  const button = document.getElementById(id);
  button.onclick = async () => {
    const pin = ui.getOperatorPin();
    if (!pin) { document.getElementById('devAccess').click(); return; }
    await ui.fill(pin, count);
  };
}
const instantStart = document.getElementById('instantStart');
instantStart.style.display = '';
instantStart.textContent = '↻ RESET TEST ROUND';
instantStart.onclick = async () => {
  if (room?.phase === 'racing' || room?.phase === 'countdown') {
    notify('Wait until the current round finishes before resetting');
    return;
  }
  const pin = ui.getOperatorPin();
  if (!pin) { document.getElementById('devAccess').click(); return; }
  if (await ui.reset(pin)) notify('Preview lobby reset · ready for a clean test');
};
document.getElementById('registrationTimer').style.display = 'none';
const devTitle = document.querySelector('#devModalTitle');
if (devTitle) devTitle.textContent = 'Sandbox Operator PIN';
const devHint = document.querySelector('#devModal p');
if (devHint) devHint.textContent = 'This PIN is validated by the shared race server when starting a preview race.';
const connectTop = document.getElementById('connectWallet');
if (connectTop) connectTop.onclick = () => document.getElementById('walletModal').classList.add('open');

socket.on('connect', () => { status.textContent = 'V27 SANDBOX · Connected · waiting for lobby'; });
socket.on('disconnect', () => { status.textContent = 'V27 SANDBOX · Reconnecting, controls disabled'; ui.setConnected(false); });
socket.on('connect_error', () => { status.textContent = 'V27 SANDBOX · Cannot reach race server'; ui.setConnected(false); });
socket.on('lobby:state', next => {
  const prev = room;
  room = next;
  ui.setConnected(true);
  ui.applyRoom(room, wallet);
  if (next.phase === 'countdown') status.textContent = 'V27 SANDBOX · Synchronized countdown';
  else if (next.phase === 'racing') status.textContent = 'V27 SANDBOX · Live shared round · V27 visual simulation';
  else if (next.phase === 'finished') status.textContent = 'V27 SANDBOX · Official winner declared · no payouts';
  else status.textContent = 'V27 SANDBOX · ' + next.entries.length + '/' + next.maxPlayers + ' racers ready';
  if (prev && prev.sessionId !== next.sessionId) notify('Race server restarted · state refreshed');
});
socket.on('race:snapshot', frame => {
  if (room && frame.raceId === room.raceId && frame.sessionId === room.sessionId) ui.setFrame(frame);
});
socket.on('race:result', result => {
  if (room && result.raceId === room.raceId) ui.setOfficialResult(result);
});
socket.on('race:error', error => notify(error));

export { socket };

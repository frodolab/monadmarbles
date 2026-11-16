import { io } from 'socket.io-client';
import { createPaidIntegration, formatWei, testnetExplorerTx, validateOnchainRoom } from './paid.js';
import { lobbyPresentation, organizerPresentation } from './lobby-status.js';

// Only the preconfigured free sandbox may be selected; no arbitrary RPC URL.
const freeDemo = new URLSearchParams(location.search).get('demo') === '1';
const serverUrl = String(freeDemo ?
  (import.meta.env.VITE_DEMO_RACE_SERVER_URL || '') :
  (import.meta.env.VITE_RACE_SERVER_URL || '')).trim();
const stage = document.querySelector('.stage');
const isPaid = () => room?.demoOnly === false;
const status = document.createElement('div');
status.id = 'livePreviewStatus';
status.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:400;background:#252054e8;color:white;border:1px solid #a399ef;border-radius:12px;padding:9px 14px;font:700 12px Nunito,sans-serif;max-width:360px';
status.textContent = freeDemo ? 'FREE DEMO · Connecting to sandbox server…' : 'MONAD TESTNET · Connecting to paid race server…';
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
  return candidates.find(candidate => candidate?.isMetaMask) || (injected?.isMetaMask ? injected : null);
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
    renderLiveControls();
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
  renderLiveControls();
});
getMetaMaskProvider()?.on?.('chainChanged', () => notify('Wallet network changed; switch to Monad Testnet'));

const paid = createPaidIntegration({
  getRoom: () => room,
  getWallet: () => wallet,
  getProvider: () => getMetaMaskProvider(),
  notify,
  onChanged: () => renderLiveControls(),
});
const join = async () => {
  if (waitingToJoin) return;
  waitingToJoin = true;
  try {
    if (!wallet) await connectWallet();
    if (hasEntry()) return notify('Your marble is already registered');
    if (room?.phase !== 'lobby') throw new Error('Registration is not open');
    const design = ui.getSelectedDesign();
    if (isPaid()) {
      await paid.join(design);
    } else {
      const nickname = short(wallet);
      await ack('lobby:join', { nickname, design });
      notify('Free preview entry registered · no MON transferred');
    }
  } catch (error) { notify(error.message || 'Unable to join'); }
  finally { waitingToJoin = false; }
};

ui.connected = false;
ui.verifyOperatorPin = async pin => {
  await ack('operator:verify', { pin });
  return true;
};
ui.join = join;
ui.poolDisplay = () => {
  if (!isPaid()) return (Number(room?.entries?.length || 0) * .1).toFixed(1);
  return formatWei(room.prizePoolWei || room.blockchain?.poolWei || '0');
};
ui.joinReady = () => {
  if (!isPaid()) return true;
  try {
    validateOnchainRoom(room, true);
    return !paid.busy && !paid.matchesPending();
  } catch { return false; }
};
ui.getPendingPayment = () => paid.pending;
ui.fill = async (pin, count) => {
  try {
    if (isPaid()) throw new Error('Bots cannot enter paid on-chain races.');
    await ack('lobby:fill', { pin, count });
    notify('Added free preview racers');
    return true;
  }
  catch (error) { notify(error.message); return false; }
};
ui.start = async pin => {
  try {
    // Never run a paid-looking V27 animation against the legacy short-track engine.
    if (room?.course !== 'v27') {
      throw new Error('The sandbox backend is still running the legacy track. Start is blocked until RACE_COURSE=v27 is deployed.');
    }
    if (isPaid()) {
      validateOnchainRoom(room);
      notify('Closing on-chain registration using the authorized settler. Confirming final entrants…');
    }
    await ack('lobby:start', { pin }, 145000);
    notify(isPaid() ? 'On-chain entries locked and confirmed · synchronized ten-second countdown' :
      'Server accepted start · synchronized ten-second countdown');
    return true;
  } catch (error) { notify(error.message); return false; }
};
ui.reset = async pin => {
  try {
    if (isPaid()) throw new Error('Paid races cannot be reset. Use on-chain cancellation/refunds.');
    await ack('lobby:reset', { pin }); return true;
  }
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
  if (await ui.reset(pin)) notify('Free preview lobby reset · ready for a clean test');
};
document.getElementById('registrationTimer').style.display = 'none';
const devTitle = document.querySelector('#devModalTitle');
if (devTitle) devTitle.textContent = 'Sandbox Operator PIN';
const devHint = document.querySelector('#devModal p');
if (devHint) devHint.textContent = 'This PIN is validated by the shared race server when starting a preview race.';
// Organizer actions are always discoverable in the normal V27 paid lobby.
// Open submissions is a contract-owner MetaMask transaction; starting requires
// the operator PIN and is enforced independently by the paid race server.
// Neither action authorizes or initiates a winner payout in the browser.
const organizerPanel = document.getElementById('mmOrganizerPanel');
const organizerHelp = document.getElementById('mmOrganizerHelp');
const organizerPin = document.getElementById('mmOperatorPin');
const organizerPinField = document.getElementById('mmPinField');
const createRaceButton = document.getElementById('mmOpenLobby');
const startPaidButton = document.getElementById('mmStartRace');
const cancelRaceButton = document.getElementById('mmCancelRace');
let organizerActionBusy = false;

createRaceButton.onclick = async () => {
  if (organizerActionBusy || paid.busy) return;
  organizerActionBusy = true;
  organizerHelp.textContent = 'Connecting the contract owner and preparing Create Race…';
  renderLiveControls();
  try {
    if (!wallet) await connectWallet();
    await paid.createRace();
    organizerHelp.textContent = 'Race creation confirmed. Waiting for on-chain registrations to open…';
  } catch (error) {
    const message = error?.message || 'Could not open on-chain registration';
    organizerHelp.textContent = message;
    notify(message);
  } finally {
    organizerActionBusy = false;
    renderLiveControls();
  }
};

startPaidButton.onclick = async () => {
  if (organizerActionBusy || paid.busy || !isPaid()) return;
  const pin = organizerPin.value.trim() || ui.getOperatorPin();
  if (!pin) {
    organizerHelp.textContent = 'Enter the backend OPERATOR_PIN above to start the race.';
    organizerPin.focus();
    return;
  }
  organizerActionBusy = true;
  organizerHelp.textContent = 'Closing on-chain entries and verifying participants. The server will start the ten-second countdown…';
  renderLiveControls();
  try {
    const started = await ui.start(pin);
    if (started) {
      organizerPin.value = '';
      organizerHelp.textContent = 'Registration closed on-chain. The synchronized ten-second countdown will begin.';
    } else {
      organizerHelp.textContent = 'Start was rejected. Verify the operator PIN, entrants and blockchain state.';
    }
  } finally {
    organizerActionBusy = false;
    renderLiveControls();
  }
};

cancelRaceButton.onclick = async () => {
  if (organizerActionBusy || paid.busy || !isPaid()) return;
  if (!window.confirm('Cancel this REAL Monad Testnet race? Entrants must claim their own refunds.')) return;
  organizerActionBusy = true;
  organizerHelp.textContent = 'Waiting for owner-authorized cancellation transaction…';
  renderLiveControls();
  try {
    if (!wallet) await connectWallet();
    await paid.cancelRace();
    organizerHelp.textContent = 'Race canceled. Entrants can claim refunds from the contract.';
  } catch (error) {
    const message = error?.message || 'Could not cancel contract race';
    organizerHelp.textContent = message;
    notify(message);
  } finally {
    organizerActionBusy = false;
    renderLiveControls();
  }
};

const pendingButton = document.createElement('button');
pendingButton.type = 'button';
pendingButton.id = 'checkPendingPaidEntry';
pendingButton.className = 'btn yellow';
pendingButton.style.cssText = 'display:none;margin:4px auto;max-width:320px;font-size:12px;';
pendingButton.textContent = 'CHECK PENDING ON-CHAIN PAYMENT';
pendingButton.onclick = async () => {
  try { await paid.checkPayment(); }
  catch (error) { notify(error.message || 'Could not confirm existing payment'); }
};
document.querySelector('.bowl-wrap').append(pendingButton);

const refundButton = document.createElement('button');
refundButton.type = 'button';
refundButton.id = 'claimPaidRefund';
refundButton.style.cssText = 'display:none;position:fixed;right:14px;bottom:14px;z-index:330;padding:6px 10px;border-radius:10px;';
refundButton.textContent = 'Claim canceled-race refund';
refundButton.onclick = async () => {
  const raceId = window.prompt('Numeric ID of the canceled Monad Testnet race to refund:');
  if (raceId === null) return;
  try {
    if (!wallet) await connectWallet();
    await paid.claimRefund(raceId.trim());
  } catch (error) { notify(error.message || 'Refund claim failed'); }
};
document.body.append(refundButton);

const settlementPanel = document.createElement('div');
settlementPanel.id = 'onchainSettlementStatus';
settlementPanel.style.cssText = 'display:none;position:fixed;bottom:44px;right:12px;z-index:325;background:#252054ee;color:white;border:1px solid #a399ef;border-radius:12px;padding:10px 14px;max-width:340px;font:700 12px Nunito,sans-serif;';
document.body.append(settlementPanel);
function renderLiveControls() {
  standaloneWalletButton.textContent = wallet ?
    '🦊 METAMASK CONNECTED · ' + short(wallet) : '🦊 CONNECT METAMASK';
  if (!room) {
    // Keep the organizer entry point visible even when Railway is waking up,
    // so an offline backend never looks like the controls were deleted.
    organizerPanel.hidden = freeDemo;
    createRaceButton.hidden = false;
    createRaceButton.disabled = true;
    startPaidButton.hidden = true;
    organizerPinField.hidden = true;
    cancelRaceButton.hidden = true;
    organizerHelp.textContent = socket.connected ?
      'Waiting for Monad Testnet race state…' : 'Connecting to the paid race server…';
    lobbyMessage.textContent = socket.connected ?
      'Waiting for the shared race lobby…' :
      'Connecting to the race server. You can still connect MetaMask.';
    document.getElementById('join').disabled = true;
    return;
  }
  const paying = isPaid();
  const organizerView = organizerPresentation({
    room, connected: socket.connected, busy: organizerActionBusy || paid.busy,
  });
  organizerPanel.hidden = !organizerView.visible;
  createRaceButton.hidden = !organizerView.open;
  createRaceButton.disabled = !organizerView.canOpen;
  startPaidButton.hidden = !organizerView.start;
  startPaidButton.disabled = !organizerView.canStart;
  organizerPinField.hidden = !organizerView.start;
  cancelRaceButton.hidden = !organizerView.cancel;
  cancelRaceButton.disabled = !socket.connected || paid.busy || organizerActionBusy;
  // Preserve helpful action-specific errors instead of immediately overwriting
  // them with a generic status while an on-chain transaction is still pending.
  if (!organizerActionBusy) organizerHelp.textContent = organizerView.help;
  document.getElementById('addOne').style.display = paying ? 'none' : '';
  document.getElementById('addTen').style.display = paying ? 'none' : '';
  instantStart.style.display = paying ? 'none' : '';
  const payment = paid.pending;
  pendingButton.style.display = paying && payment ? '' : 'none';
  pendingButton.disabled = paid.busy;
  refundButton.style.display = paying ? '' : 'none';
  const paidFee = formatWei(room.blockchain?.entryFeeWei);
  const feeLabel = paidFee === '?' ? 'TESTNET MON' : paidFee + ' TESTNET MON';
  const joined = hasEntry();
  const joinButton = document.getElementById('join');
  const view = lobbyPresentation({
    room, connected:socket.connected, hasWallet:Boolean(wallet), joined,
    pending:paying&&paid.matchesPending(), busy:paid.busy,
    feeLabel, ready:!paying||ui.joinReady(),
  });
  joinButton.textContent = view.joinLabel;
  joinButton.disabled = view.joinDisabled;
  lobbyMessage.textContent = view.message;
  document.getElementById('walletTitle').textContent = paying ? 'CONNECT METAMASK · MONAD TESTNET' :
    'CONNECT METAMASK · FREE PREVIEW';
  document.querySelector('.wallet-disclaimer').textContent = paying ?
    'CONFIRM AN ON-CHAIN PAYMENT IN METAMASK. TESTNET MON GOES TO THE V2 CONTRACT, NEVER TO THIS SERVER.' :
    'FREE SANDBOX · META MASK CONNECTION ONLY · NO ENTRY PAYMENT';
  document.querySelector('.mock-note').textContent = paying ? 'MONAD TESTNET' : 'FREE SANDBOX';
  document.querySelector('.footer').textContent = paying ?
    'MONAD TESTNET · V27 AUTHORITATIVE TRACK · V2 VERIFIED ENTRY & AUTOMATIC FIRST-PLACE PAYOUT' :
    'V27 SANDBOX · FREE ENTRIES · NO ON-CHAIN PAYOUTS';
  settlementPanel.style.display = paying ? '' : 'none';
  if (paying) {
    settlementPanel.replaceChildren();
    const line = document.createElement('div');
    const status = room.payout;
    const chain = room.blockchain;
    const phase = status?.status || 'waiting';
    line.textContent = 'TESTNET · ' + (chain?.status || room.phase).toUpperCase() +
      ' · POOL ' + ui.poolDisplay() + ' MON' +
      (status?.enabled ? ' · PAYOUT ' + phase.toUpperCase() : '');
    settlementPanel.append(line);
    const latestTx = testnetExplorerTx(status?.txHash || payment?.txHash);
    if (latestTx) {
      const a = document.createElement('a');
      a.href = latestTx;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.style.color = '#ead393';
      a.textContent = status?.txHash ? 'VIEW WINNER PAYOUT TRANSACTION' : 'VIEW PENDING ENTRY TRANSACTION';
      settlementPanel.append(a);
    }
    if (status?.error) {
      const warning = document.createElement('div');
      warning.textContent = 'Settlement issue: ' + status.error;
      settlementPanel.append(warning);
    }
    if (chain?.status === 'error') {
      const warning = document.createElement('div');
      warning.textContent = 'Chain synchronization unavailable. Payments/start locked.';
      settlementPanel.append(warning);
    }
  }
}

const standaloneWalletButton = document.getElementById('walletConnectCta');
const lobbyMessage = document.getElementById('mmLobbyNotice');
const modeSwitch = document.getElementById('mmModeSwitch');
modeSwitch.href = freeDemo ? '/' : '/?demo=1';
modeSwitch.textContent = freeDemo ? 'Switch to paid Monad Testnet races' : 'Want bots? Open the free demo (no MON)';
standaloneWalletButton.onclick = async () => {
  try { await connectWallet(); }
  catch (error) { notify(error.message || 'Could not connect MetaMask'); }
  finally { renderLiveControls(); }
};
const connectTop = document.getElementById('connectWallet');
if (connectTop) connectTop.onclick = () => document.getElementById('walletModal').classList.add('open');

socket.on('connect', () => { status.textContent = 'Connected · waiting for race state'; renderLiveControls(); });
socket.on('disconnect', () => { status.textContent = 'Race server reconnecting · wallet remains available'; ui.setConnected(false); renderLiveControls(); });
socket.on('connect_error', () => { status.textContent = 'Cannot reach race server · retrying'; ui.setConnected(false); renderLiveControls(); });
socket.on('lobby:state', next => {
  const prev = room;
  room = next;
  ui.setConnected(true);
  paid.refreshFromRoom(room);
  ui.applyRoom(room, wallet);
  renderLiveControls();
  if (next.course !== 'v27') {
    status.textContent = 'V27 SANDBOX · Backend course mismatch — start disabled';
    document.getElementById('start').disabled = true;
    return;
  }
  if (next.phase === 'countdown') status.textContent = 'V27 SANDBOX · Synchronized countdown';
  else if (next.phase === 'racing') status.textContent = (isPaid() ? 'MONAD TESTNET' : 'FREE SANDBOX') + ' · Shared V27 authoritative race';
  else if (next.phase === 'finished') {
    status.textContent = isPaid() ? 'MONAD TESTNET · Race finished · payout ' + (next.payout?.status || 'processing') :
      'V27 SANDBOX · Official winner declared · no payouts';
  } else status.textContent = (isPaid() ? 'MONAD TESTNET' : 'FREE SANDBOX') +
    ' · ' + next.entries.length + '/' + next.maxPlayers + ' racers ready';
  if (prev && prev.sessionId !== next.sessionId) notify('Race server restarted · state refreshed');
});
socket.on('race:snapshot', frame => {
  if (room && frame.raceId === room.raceId && frame.sessionId === room.sessionId) ui.setFrame(frame);
});
socket.on('race:result', result => {
  if (room && result.raceId === room.raceId) ui.setOfficialResult(result);
});
socket.on('race:error', error => notify(error));

renderLiveControls();
export { socket };

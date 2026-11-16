import { io } from 'socket.io-client';
import { createPaidIntegration, formatWei, testnetExplorerTx, validateOnchainRoom, registrationMessage } from './paid.js';
import { lobbyPresentation, organizerPresentation } from './lobby-status.js';
import { GameAudio } from './audio.js';

// Only the preconfigured free sandbox may be selected; no arbitrary RPC URL.
const freeDemo = new URLSearchParams(location.search).get('demo') === '1';
const serverUrl = String(freeDemo ?
  (import.meta.env.VITE_DEMO_RACE_SERVER_URL || '') :
  (import.meta.env.VITE_RACE_SERVER_URL || '')).trim();
const stage = document.querySelector('.stage');
const isPaid = () => room?.demoOnly === false;
// No floating status HUD on the public lobby.
const status = { textContent: '' };

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

// Audio is presentation-only and synthesized locally: never touches wallet
// permissions, contract transactions or authoritative race/settlement data.
const gameAudio = new GameAudio();
gameAudio.setToggle(document.getElementById('gameSoundToggle'));
ui.onPodiumReveal = () => gameAudio.onPodium();
ui.onAudioReturn = () => gameAudio.onReturn();
// Browser gesture policy: wake the AudioContext only from a real user action.
document.addEventListener('pointerdown', event => {
  if (event.target?.closest?.('#gameSoundToggle')) return;
  gameAudio.unlock();
}, { capture: true });
document.addEventListener('keydown', event => {
  if (event.repeat || event.target?.closest?.('#gameSoundToggle')) return;
  gameAudio.unlock();
}, { capture: true });
document.addEventListener('visibilitychange', () => gameAudio.onVisibilityChange());
window.addEventListener('pagehide', () => gameAudio.dispose());

const ack = async (event, payload, timeout = 7000) => {
  if (!socket.connected) throw new Error('Race server is disconnected');
  const response = await socket.timeout(timeout).emitWithAck(event, payload);
  if (!response?.ok) throw new Error(response?.error || 'Action was rejected');
  return response;
};
// Successful wallet connections, blockchain submissions and lobby updates
// are reflected by the actual marble and contract state, not purple toasts.
const notify = () => {};
const showError = error => {
  const message = String(error?.message || error || 'Action failed');
  // An error is actionable; do not silently swallow rejected wallet payments.
  window.alert(message);
};
const hasEntry = () => Boolean(wallet && room?.phase !== 'finished' && room?.entries?.some(entry =>
  (entry.wallet && entry.wallet.toLowerCase() === wallet.toLowerCase()) ||
  entry.nickname === short(wallet)));
// EIP-1193 single-flight: one wallet permission request at a time.
// eth_accounts is silent; only eth_requestAccounts opens a new approval prompt.
const getMetaMaskProvider = () => {
  const injected = window.ethereum;
  const candidates = Array.isArray(injected?.providers) ? injected.providers : [injected];
  return candidates.find(candidate => candidate?.isMetaMask) || (injected?.isMetaMask ? injected : null);
};
let connectInFlight = null;
// Nickname approvals are optional. Reuse a signature if the server request
// fails and the player retries the exact same name for the exact same entry.
const nicknameSignatures = new Map();
const connectWallet = async () => {
  if (connectInFlight) return connectInFlight;
  const provider = getMetaMaskProvider();
  if (!provider?.request) throw new Error('Install or enable MetaMask to join the race');
  connectInFlight = (async () => {
    let accounts = await provider.request({ method: 'eth_accounts' });
    if (!accounts?.[0]) {
      accounts = await provider.request({ method: 'eth_requestAccounts' });
    }
    if (!accounts?.[0]) throw new Error('No MetaMask account was returned');
    // Connecting is identity-only. Never auto-switch/add chain on connect:
    // those are extra wallet prompts, unrelated to permission approval.
    // paid.js validates Monad Testnet immediately before sending a payment.
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

// Restore a previously authorized account without opening an approval popup.
// eth_accounts is a silent read: NEVER call eth_requestAccounts on page load.
async function restoreWalletSilently() {
  const provider = getMetaMaskProvider();
  if (!provider?.request || wallet || connectInFlight) return;
  try {
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || !/^0x[0-9a-f]{40}$/i.test(String(accounts[0] || ''))) return;
    if (wallet || connectInFlight) return; // A manual connection may have completed.
    wallet = accounts[0];
    ui.setWallet(wallet);
    ui.applyRoom(room, wallet);
    renderLiveControls();
  } catch { /* Wallet is locked or unavailable; no user prompt on page load. */ }
}

const paid = createPaidIntegration({
  getRoom: () => room,
  getWallet: () => wallet,
  getProvider: () => getMetaMaskProvider(),
  notify,
  onChanged: () => renderLiveControls(),
});
// The ONE visible button connects MetaMask, then (on a later deliberate click)
// submits an entry only when the server reports verified paid registration.
const join = async () => {
  if (waitingToJoin) return;
  waitingToJoin = true;
  try {
    if (!wallet) {
      await connectWallet();
      return;
    }
    if (hasEntry()) return;
    if (paid.matchesPending()) {
      await paid.checkPayment();
      return;
    }
    if (!room || !socket.connected) return;
    if (room.phase !== 'lobby' ||
        (isPaid() && (room.blockchain?.status !== 'open' || !ui.joinReady()))) return;
    const design = ui.getSelectedDesign();
    if (isPaid()) {
      await paid.join(design);
    } else {
      await ack('lobby:join', { nickname: short(wallet), design });
    }
  } catch (error) {
    showError(error);
  } finally {
    waitingToJoin = false;
    renderLiveControls();
  }
};

ui.connected = false;
ui.verifyOperatorPin = async pin => {
  await ack('operator:verify', { pin });
  return true;
};
ui.join = join;
ui.poolDisplay = () => {
  if (room?.phase === 'finished' && ui.isDismissed?.(ui.currentRaceKey?.())) return '0';
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
let nicknameSaving = false;
ui.isNicknameSaving = () => nicknameSaving;
// Nickname is authenticated by the actual paid-entry MetaMask wallet. Signing
// happens ONLY after an explicit click of SAVE, not during wallet connection.
ui.saveNickname = async rawValue => {
  if (nicknameSaving) return;
  const nickname = String(rawValue || '').trim();
  if (!nickname || nickname.length > 18 || /[<>\x00-\x1F\x7F]/.test(nickname)) {
    showError('Nickname must be 1–18 printable characters (no < or >).');
    return;
  }
  if (!wallet) { showError('Click JOIN THE RACE to connect MetaMask first.'); return; }
  if (!room || room.phase !== 'lobby') {
    showError('Nickname changes are available only while race submissions are open.');
    return;
  }
  const editor = document.getElementById('nick');
  const saveButton = document.getElementById('saveName');
  const entry = room.entries?.find(item => item.wallet?.toLowerCase() === wallet.toLowerCase());
  if (!entry) {
    // Keep the preferred value in the input. Do not create a fake server entry
    // and do not request a signature before a paid tx is confirmed.
    editor.value = nickname;
    saveButton.textContent = 'READY';
    return;
  }
  if (entry.nickname === nickname) { saveButton.textContent = 'SAVED'; return; }
  if (!isPaid()) {
    showError('Signed nicknames require an on-chain race entry.');
    return;
  }
  if (room.blockchain?.status !== 'open' || !room.blockchain?.synced) {
    showError('Wait for registration to finish verifying before saving the nickname.');
    return;
  }
  if (!/^0x[0-9a-f]{64}$/i.test(String(entry.txHash || ''))) {
    showError('Verified entry transaction is not available yet.');
    return;
  }
  nicknameSaving = true;
  saveButton.disabled = true;
  saveButton.textContent = 'SIGN…';
  try {
    const provider = getMetaMaskProvider();
    if (!provider) throw new Error('MetaMask is required to verify your nickname.');
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) ||
        !accounts.some(x => x.toLowerCase() === wallet.toLowerCase())) {
      throw new Error('Reconnect the paying MetaMask wallet first.');
    }
    const raceId = String(room.blockchain.chainRaceId);
    const message = registrationMessage({
      raceId, txHash: entry.txHash, nickname,
      contractAddress: room.blockchain.contractAddress,
    });
    const signatureKey = wallet.toLowerCase() + ':' + raceId + ':' +
      entry.txHash.toLowerCase() + ':' + nickname;
    let signature = nicknameSignatures.get(signatureKey);
    if (!signature) {
      signature = await provider.request({ method: 'personal_sign', params: [message, wallet] });
      if (/^0x[0-9a-f]{130}$/i.test(String(signature || ''))) {
        nicknameSignatures.set(signatureKey, signature);
      }
    }
    if (!/^0x[0-9a-f]{130}$/i.test(String(signature || ''))) {
      throw new Error('MetaMask did not return a valid nickname signature.');
    }
    await ack('lobby:verify',
      { raceId, txHash:entry.txHash, nickname, signature }, 30000);
    saveButton.textContent = 'SAVED';
    // The backend sends the updated name to every viewer in lobby:state.
  } catch (error) {
    saveButton.textContent = 'SAVE';
    showError(error);
  } finally {
    nicknameSaving = false;
    saveButton.disabled = false;
  }
};
ui.fill = async (pin, count) => {
  try {
    if (isPaid()) throw new Error('Bots cannot enter paid on-chain races.');
    await ack('lobby:fill', { pin, count });
    notify('Added free preview racers');
    return true;
  }
  catch (error) { showError(error); return false; }
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
  } catch (error) { showError(error); return false; }
};
ui.reset = async pin => {
  try {
    if (isPaid()) throw new Error('Paid races cannot be reset. Use on-chain cancellation/refunds.');
    await ack('lobby:reset', { pin }); return true;
  }
  catch (error) { showError(error); return false; }
};
ui.connectWallet = connectWallet;

document.querySelectorAll('[data-wallet]').forEach(button => {
  if (button.dataset.wallet !== 'MetaMask') button.style.display = 'none';
  else button.onclick = async () => {
    try { await connectWallet(); document.getElementById('walletModal').classList.remove('open'); }
    catch (error) { showError(error); }
  };
});
const walletTitle = document.querySelector('#walletTitle');
if (walletTitle) walletTitle.textContent = 'CONNECT METAMASK · PREVIEW';
const disclaimer = document.querySelector('.wallet-disclaimer');
if (disclaimer) disclaimer.textContent = 'CONNECT: ONE ACCOUNT APPROVAL IF NOT ALREADY AUTHORIZED · NO SIGNATURE ON CONNECT';
document.querySelector('.footer').textContent = 'V27 INTEGRATION SANDBOX · SHARED SERVER · NO ON-CHAIN ENTRY OR PAYOUT';
document.querySelector('.mock-note').textContent = 'FREE SANDBOX';
document.getElementById('join').textContent = 'JOIN THE RACE';
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
const devTitle = document.querySelector('#devModalTitle');
if (devTitle) devTitle.textContent = 'Operator PIN';
const devHint = document.querySelector('#devModal p');
if (devHint) devHint.textContent = 'Unlock race creation, cancellation and PIN-authorized start.';

const controls = document.querySelector('.devbuttons');
// All organizer actions are INSIDE the PIN-locked V27 devbox. No controls,
// status labels or wallet connect buttons appear elsewhere on the homepage.
const createRaceButton = document.createElement('button');
createRaceButton.type = 'button';
createRaceButton.id = 'createPaidRace';
createRaceButton.textContent = '＋ OPEN SUBMISSIONS';
controls.append(createRaceButton);

const cancelRaceButton = document.createElement('button');
cancelRaceButton.type = 'button';
cancelRaceButton.id = 'cancelPaidRace';
cancelRaceButton.textContent = 'CANCEL RACE';
controls.append(cancelRaceButton);

const operatorHelp = document.createElement('span');
operatorHelp.id = 'mmOperatorHelp';
operatorHelp.style.cssText = 'display:block;grid-column:1 / -1;font-size:10px;font-weight:800;color:#ffebac;line-height:1.2';
controls.append(operatorHelp);

const payoutLink = document.createElement('a');
payoutLink.id = 'mmOperatorPayout';
payoutLink.style.cssText = 'display:none;grid-column:1 / -1;font-size:10px;font-weight:900;color:#ffe28e;text-align:center;text-decoration:underline';
payoutLink.target = '_blank';
payoutLink.rel = 'noopener noreferrer';
payoutLink.textContent = 'View payout on Monad Explorer';
controls.append(payoutLink);

let operatorActionBusy = false;
const operationError = error => {
  operatorHelp.textContent = String(error?.message || error || 'Operator action failed');
  showError(error);
};

createRaceButton.onclick = async () => {
  if (operatorActionBusy || paid.busy || !socket.connected) return;
  operatorActionBusy = true;
  operatorHelp.textContent = 'Preparing the on-chain race in MetaMask…';
  renderLiveControls();
  try {
    if (!wallet) await connectWallet();
    await paid.createRace();
    operatorHelp.textContent = 'Create Race confirmed. Waiting for verified on-chain registration to open…';
  } catch (error) {
    operationError(error);
  } finally {
    operatorActionBusy = false;
    renderLiveControls();
  }
};
cancelRaceButton.onclick = async () => {
  if (operatorActionBusy || paid.busy || !socket.connected) return;
  if (!window.confirm('Cancel the real on-chain race? Paid entrants must claim their own refunds.')) return;
  operatorActionBusy = true;
  renderLiveControls();
  try {
    if (!wallet) await connectWallet();
    await paid.cancelRace();
    operatorHelp.textContent = 'Race cancelled. Entrants may claim refunds through the dedicated refund page.';
  } catch (error) {
    operationError(error);
  } finally {
    operatorActionBusy = false;
    renderLiveControls();
  }
};

// Refund claims are an entrant right, never restricted by the operator PIN.
// They remain available via ?refund=1, not as a floating public lobby box.
const refundRoute = new URLSearchParams(location.search).get('refund') === '1';
if (refundRoute) {
  const claim = document.createElement('button');
  claim.textContent = 'CLAIM CANCELED-RACE REFUND';
  claim.type = 'button';
  claim.style.cssText = 'position:fixed;bottom:15px;left:50%;transform:translateX(-50%);z-index:350;padding:12px 18px;border-radius:12px;font-weight:900';
  claim.onclick = async () => {
    const raceId = window.prompt('Canceled on-chain race ID:');
    if (raceId === null) return;
    try {
      if (!wallet) await connectWallet();
      await paid.claimRefund(raceId.trim());
    } catch (error) {
      showError(error);
    }
  };
  document.body.append(claim);
}

function renderLiveControls() {
  const joinButton = document.getElementById('join');
  // EXACT user-approved wording. Never replace it with a status or wallet CTA.
  joinButton.textContent = hasEntry() ? 'ENTERED RACE' : 'JOIN THE RACE';
  // A user must always be able to initiate an identity-only wallet connection
  // even before the contract owner creates a race.
  joinButton.disabled = hasEntry() || waitingToJoin || paid.busy;
  // A pre-entry nickname is only a draft. After payment is verified, make
  // the required explicit signature action discoverable as SAVE again.
  const nicknameButton = document.getElementById('saveName');
  if (hasEntry() && nicknameButton?.textContent === 'READY') nicknameButton.textContent = 'SIGN NAME (OPTIONAL)';

  if (!room) {
    createRaceButton.style.display = 'none';
    cancelRaceButton.style.display = 'none';
    start.disabled = true;
    start.style.display = '';
    operatorHelp.textContent = 'Connecting to race server…';
    return;
  }
  const paying = isPaid();
  const organizer = organizerPresentation({
    room, connected: socket.connected, busy: operatorActionBusy || paid.busy,
  });
  document.getElementById('addOne').style.display = paying ? 'none' : '';
  document.getElementById('addTen').style.display = paying ? 'none' : '';
  instantStart.style.display = paying ? 'none' : '';

  createRaceButton.style.display = paying && organizer.open ? '' : 'none';
  createRaceButton.disabled = !organizer.canOpen;
  cancelRaceButton.style.display = paying && organizer.cancel ? '' : 'none';
  cancelRaceButton.disabled = !socket.connected || operatorActionBusy || paid.busy;
  start.style.display = paying && !organizer.start ? 'none' : '';
  start.textContent = '▶ START RACE';
  start.disabled = paying ? !organizer.canStart :
    !socket.connected || room.phase !== 'lobby' || room.entries.length < 2;
  if (!operatorActionBusy) operatorHelp.textContent = organizer.help;

  const payoutUrl = paying ? testnetExplorerTx(room.payout?.txHash) : null;
  payoutLink.style.display = payoutUrl ? '' : 'none';
  if (payoutUrl) payoutLink.href = payoutUrl;

  // Keep the verified pool and selected marble visible without secondary badges.
  document.querySelector('.mock-note').hidden = true;
  document.querySelector('.footer').hidden = true;
}

// Read existing MetaMask permission once, without prompting the player.
void restoreWalletSilently();

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
  if (next.course === 'v27') gameAudio.onRoom(next);
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
  if (room && frame.raceId === room.raceId && frame.sessionId === room.sessionId) {
    ui.setFrame(frame);
    gameAudio.onFrame(frame);
  }
});
socket.on('race:result', result => {
  if (room && result.raceId === room.raceId) ui.setOfficialResult(result);
});
socket.on('race:error', error => showError(error));

renderLiveControls();
export { socket };

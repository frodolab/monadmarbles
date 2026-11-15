// Pure presentation state: never authorizes payment, starts or race admission.
// Those are enforced separately by paid.js and the chain-verifying race server.
export function lobbyPresentation({room, connected, hasWallet=false, joined=false, pending=false, busy=false, feeLabel='TESTNET MON', ready=false} = {}) {
  if (!connected || !room) return {
    joinLabel:'WAITING FOR RACE SERVER', joinDisabled:true,
    message:'Connecting to the race server… MetaMask can still connect independently.',
  };
  const count = Array.isArray(room.entries) ? room.entries.length : 0;
  const full = count >= Number(room.maxPlayers || 48);
  if (room.demoOnly === true) {
    if (room.phase === 'lobby') return {
      joinLabel:joined?'✓ ENTERED FREE RACE':'✦ JOIN FREE DEMO ✦',
      joinDisabled:joined||full,
      message:full?'The free race is full.': 'Free demo ready. Bots can join through Dev Access. No MON is transferred.',
    };
    return {joinLabel:'FREE RACE IN PROGRESS',joinDisabled:true,
      message:room.phase==='finished'?'Free race complete. Use Dev Access → Reset Test Round to start again.':'Free race is underway. Wait for its result.'};
  }
  const chain=room.blockchain||{};
  if (room.phase === 'waiting' || chain.status === 'waiting') return {
    joinLabel:'WAITING FOR ON-CHAIN RACE',joinDisabled:true,
    message:'No race is open yet. Connect MetaMask now; the organizer must unlock Dev Access and select CREATE ON-CHAIN RACE.',
  };
  if (chain.status === 'error' || chain.status === 'interrupted' || room.phase === 'interrupted') return {
    joinLabel:'ON-CHAIN ENTRIES PAUSED',joinDisabled:true,
    message:'Monad Testnet verification is paused or interrupted. Do not send payments; the operator must investigate.',
  };
  if (room.phase === 'lobby' && chain.status === 'open') {
    if (joined) return {joinLabel:'✓ VERIFIED ON-CHAIN ENTRY',joinDisabled:true,
      message:'Your payment is confirmed. Your marble is registered for this on-chain race.'};
    if (pending) return {joinLabel:'PAYMENT PENDING · CHECK STATUS',joinDisabled:true,
      message:'An entry transaction already exists. Check Pending Payment—do not submit another payment.'};
    if (full) return {joinLabel:'RACE FULL',joinDisabled:true,
      message:'All entry slots are filled. Wait for the next on-chain race.'};
    if (!ready) return {joinLabel:'ON-CHAIN ENTRY UNAVAILABLE',joinDisabled:true,
      message:'Contract validation or confirmations are not ready. Do not send a payment yet.'};
    return {joinLabel:'✦ PAY '+feeLabel+' & JOIN ✦',joinDisabled:busy,
      message:hasWallet?'On-chain registration is open. Select a marble, then confirm the payment in MetaMask.':
        'On-chain registration is open. Connect MetaMask or click Join to connect and pay.'};
  }
  if (room.phase==='countdown') return {
    joinLabel:'ENTRIES CLOSED · 10-SECOND COUNTDOWN',joinDisabled:true,
    message:'The organizer has closed on-chain entries. The synchronized race countdown has begun.',
  };
  if (room.phase==='racing') return {
    joinLabel:'RACE IN PROGRESS',joinDisabled:true,
    message:'Marbles are racing on the server-authoritative V27 track. New entries are closed.',
  };
  if (room.phase==='finished') return {
    joinLabel:'RACE FINISHED',joinDisabled:true,
    message:'This race is complete. The winner payout is handled automatically by the server; wait for the next race.',
  };
  return {
    joinLabel:'ON-CHAIN ENTRIES CLOSED',joinDisabled:true,
    message:'Contract registration is not currently open. The operator must create or resolve an on-chain race.',
  };
}

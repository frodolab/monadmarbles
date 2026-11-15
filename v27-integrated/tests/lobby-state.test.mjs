import test from 'node:test';
import assert from 'node:assert/strict';
import { lobbyPresentation } from '../src/lobby-status.js';

const waiting={
  phase:'waiting',demoOnly:false,entries:[],maxPlayers:48,
  blockchain:{mode:'onchain',status:'waiting',chainRaceId:null},
};
const open={
  phase:'lobby',demoOnly:false,entries:[],maxPlayers:48,
  blockchain:{mode:'onchain',status:'open',chainRaceId:'9'},
};
test('waiting paid lobby explains why Join is unavailable, not a running race',()=>{
 const view=lobbyPresentation({room:waiting,connected:true});
 assert.match(view.message,/organizer must unlock Dev Access/);
 assert.match(view.joinLabel,/WAITING FOR ON-CHAIN RACE/);
 assert.equal(view.joinDisabled,true);
 assert.doesNotMatch(view.message,/90-second|timer/i);
});
test('MetaMask can be connected separately in every lobby state',()=>{
 const view=lobbyPresentation({room:waiting,connected:true,hasWallet:false});
 assert.match(view.message,/Connect MetaMask now/);
});
test('open paid race accepts joining and explains payment',()=>{
 const view=lobbyPresentation({room:open,connected:true,ready:true,hasWallet:false,feeLabel:'0.1 TESTNET MON'});
 assert.equal(view.joinDisabled,false);
 assert.match(view.joinLabel,/PAY 0.1 TESTNET MON/);
 assert.match(view.message,/MetaMask/);
});
test('pending transaction never enables a second payment',()=>{
 const view=lobbyPresentation({room:open,connected:true,ready:true,hasWallet:true,pending:true});
 assert.equal(view.joinDisabled,true);
 assert.match(view.joinLabel,/PENDING/);
});
test('free bot lobby remains separate from paid admission',()=>{
 const room={phase:'lobby',demoOnly:true,entries:[],maxPlayers:48};
 const view=lobbyPresentation({room,connected:true});
 assert.equal(view.joinDisabled,false);
 assert.match(view.message,/Bots can join/);
 assert.match(view.message,/No MON/);
});
test('server-only countdown and completed phases lock registration',()=>{
 for(const phase of ['countdown','racing','finished']){
   const view=lobbyPresentation({room:{...open,phase},connected:true,ready:true});
   assert.equal(view.joinDisabled,true);
 }
});
test('failed chain sync and disconnected backend never enable payments',()=>{
 const err=lobbyPresentation({room:{...open,blockchain:{status:'error'}},connected:true,ready:true});
 assert.equal(err.joinDisabled,true);
 assert.match(err.message,/Do not send payments/);
 assert.equal(lobbyPresentation({room:open,connected:false,ready:true}).joinDisabled,true);
});

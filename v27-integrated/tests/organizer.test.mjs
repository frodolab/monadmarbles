import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { organizerPresentation } from '../src/lobby-status.js';

const baseRoom = {
  phase:'waiting',demoOnly:false,entries:[],maxPlayers:48,
  blockchain:{mode:'onchain',status:'waiting',synced:true,chainId:10143},
};
function view(room,opts={}) {
  return organizerPresentation({room,connected:true,...opts});
}

test('organizer can see OPEN SUBMISSIONS before any on-chain race exists',()=>{
  const state=view(baseRoom);
  assert.equal(state.visible,true);
  assert.equal(state.open,true);
  assert.equal(state.canOpen,true);
  assert.equal(state.start,false);
  assert.match(state.help,/contract owner wallet/i);
});
test('race may start only with at least 2 confirmed entrants in synced open lobby',()=>{
  const open={...baseRoom,phase:'lobby',blockchain:{...baseRoom.blockchain,status:'open'}};
  const empty=view(open);
  assert.equal(empty.start,true);
  assert.equal(empty.canStart,false);
  assert.match(empty.help,/at least two/i);
  const two=view({...open,entries:[{id:'chain-1-1'},{id:'chain-1-2'}]});
  assert.equal(two.start,true);
  assert.equal(two.canStart,true);
  assert.match(two.help,/operator PIN/i);
  const unsynced=view({...open,entries:[{id:'1'},{id:'2'}],
    blockchain:{...open.blockchain,synced:false}});
  assert.equal(unsynced.canStart,false);
});
test('disconnected or busy operator cannot send new signed transactions',()=>{
  assert.equal(view(baseRoom,{connected:false}).canOpen,false);
  assert.equal(view(baseRoom,{busy:true}).canOpen,false);
  const ready={...baseRoom,phase:'lobby',entries:[{id:'1'},{id:'2'}],
    blockchain:{...baseRoom.blockchain,status:'open'}};
  assert.equal(view(ready,{busy:true}).canStart,false);
});
test('paid controls are not shown in free demo, countdown, racing or finished',()=>{
  assert.equal(view({...baseRoom,demoOnly:true}).visible,false);
  for(const phase of ['countdown','racing','finished']){
    const v=view({...baseRoom,phase,blockchain:{...baseRoom.blockchain,status:'closed'}});
    assert.equal(v.start,false);
    assert.equal(v.open,false);
  }
});
test('the V27 page exposes discoverable organizer buttons and private PIN input',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const id of ['mmOrganizerPanel','mmOpenLobby','mmStartRace','mmOperatorPin','mmOrganizerHelp']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/<input[^>]+id="mmOperatorPin"[^>]+type="password"|<input[^>]+type="password"[^>]+id="mmOperatorPin"/);
  assert.doesNotMatch(html,/<(?:button|input)[^>]+id="mmOpenLobby"[^>]+disabled/);
});

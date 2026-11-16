import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {organizerPresentation} from '../src/lobby-status.js';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const live=await readFile(new URL('../src/live.js',import.meta.url),'utf8');
const css=await readFile(new URL('../src/style.css',import.meta.url),'utf8');

test('retired 90-second registration is completely absent from UI and logic',()=>{
  assert.doesNotMatch(html,/id="registrationTimer"|01:30|remaining=90|90-second|beginPreRaceCountdown|finishPreRaceCountdown|timer:start|timer:pause/);
  assert.doesNotMatch(live,/registrationTimer|90-second|timer:start|timer:pause/);
  assert.match(html,/preRaceRemaining=Math\.max\(0,\(Number\(next\.startsAt/);
  assert.match(html,/preRaceRemaining=10/);
});
test('podium stays visible for 15 seconds unless user returns first',()=>{
  assert.match(html,/podiumReturnTimer=setTimeout\(returnToLobbyAfterRace,15000\)/);
  assert.match(html,/onReturnToLobby\?\.\(\)/);
  assert.match(html,/clearTimeout\(podiumReturnTimer\)/);
  assert.match(html,/event\.data\?\.type==='monadmarbles:return-to-lobby'/);
});
test('return to lobby discards previous paid marbles but retains blockchain journal',()=>{
  assert.match(html,/const incoming=next\.phase==='finished'\?\[\]:/);
  assert.match(html,/restoreLobby\(\)/);
  assert.match(live,/room\?\.phase !== 'finished'/);
  assert.match(live,/room\?\.phase === 'finished' && ui\.isDismissed/);
  const state=organizerPresentation({connected:true,room:{
    phase:'finished',demoOnly:false,entries:[{id:'old'}],
    blockchain:{mode:'onchain',status:'waiting',synced:true},
  }});
  assert.equal(state.open,true);
  assert.equal(state.canOpen,true);
});
test('nickname can be typed and explicitly signed to update the authoritative roster',()=>{
  assert.match(html,/id="saveName"/);
  assert.match(html,/\.nickname-field\{display:flex!important\}/);
  assert.match(html,/#playerEditor\[hidden\]\{display:none!important\}/);
  assert.match(html,/MonadMarblesPreviewBridge\?\.saveNickname/);
  assert.match(live,/ui\.saveNickname = async rawValue/);
  assert.match(live,/method: 'personal_sign'/);
  assert.match(live,/ack\('lobby:verify'/);
  assert.match(live,/room\.entries\?\.find\(item => item\.wallet/);
  assert.doesNotMatch(html,/DESIGN LOCKED/);
});
test('race presentation has no FPS debug bubble',()=>{
  assert.match(css,/#fps\{display:none!important\}/);
});

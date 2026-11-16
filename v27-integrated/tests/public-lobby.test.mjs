import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const live=await readFile(new URL('../src/live.js',import.meta.url),'utf8');
const race=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const body=html.slice(html.indexOf('<body>'));
test('inline V27 lobby scripts still parse after race dismissal changes',()=>{
  const inlineScripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(inlineScripts.length>0);
  for(const match of inlineScripts)new vm.Script(match[1]);
});
test('public lobby displays only JOIN THE RACE / ENTERED RACE and no extra wallet CTA',()=>{
  assert.match(body,/id="join" type="button">JOIN THE RACE<\/button>/);
  for(const unwanted of ['walletConnectCta','mmLobbyNotice','mmModeSwitch',
    'mmOrganizerPanel','mmOpenLobby','mmOperatorPin','mmOrganizerHelp']){
    assert.doesNotMatch(body,new RegExp('id="'+unwanted+'"'));
  }
  assert.match(live,/joinButton\.textContent = hasEntry\(\) \? 'ENTERED RACE' : 'JOIN THE RACE'/);
  assert.match(live,/joinButton\.disabled = hasEntry\(\) \|\| waitingToJoin \|\| paid\.busy/);
  assert.match(live,/const hasEntry = \(\) => Boolean\(wallet && room/);
});
test('no lobby map selector, purple toast, prize badge or floating HUD is shown',()=>{
  assert.match(html,/#themeTrigger,#currentThemeLabel,#themeMenu,\.race-stage-heading,\.mock-note,\.footer/);
  assert.match(html,/#livePreviewStatus,#onchainSettlementStatus,#mmLobbyNotice,#mmModeSwitch/);
  assert.match(html,/#walletConnectCta,#mmOrganizerPanel,\.toast,#toast \{display:none!important\}/);
  assert.doesNotMatch(live,/document\.body\.append\(status\)/);
  assert.doesNotMatch(live,/document\.body\.append\(refundButton\)/);
  assert.doesNotMatch(live,/settlementPanel\.style\.display/);
  assert.match(race,/function toast\(msg\)\{if\(handoff\?\.livePreview\)return;/);
});
test('MetaMask Connect never auto adds or switches chains, no duplicate approval requests',()=>{
  assert.equal((live.match(/eth_requestAccounts/g)||[]).filter(Boolean).length,2);
  assert.match(live,/if \(connectInFlight\) return connectInFlight/);
  assert.match(live,/method: 'eth_accounts'/);
  assert.doesNotMatch(live,/method: 'wallet_switchEthereumChain'|method: 'wallet_addEthereumChain'/);
  assert.match(live,/if \(!wallet\) \{\s*await connectWallet\(\);\s*return;/);
});
test('return-to-lobby dismisses the exact completed round, but a new round can race',()=>{
  assert.match(html,/dismissedRaceKey:syncedRaceKey|this\.dismissedRaceKey=syncedRaceKey/);
  assert.match(html,/window\.MonadMarblesPreviewBridge\?\.onReturnToLobby\?\.\(\)/);
  assert.match(html,/window\.MonadMarblesPreviewBridge\?\.restoreLobby\?\.\(\)/);
  assert.match(html,/next\.phase==='racing'&&!raceActive&&!raceTransitioning&&!this\.isDismissed\?\.\(key\)/);
  assert.doesNotMatch(html,/next\.phase==='racing'\|\|next\.phase==='finished'\)\&\&!raceActive/);
  assert.match(html,/setOfficialResult\(result\)\{\s*if\(this\.isDismissed\(syncedRaceKey\)\)return/);
  assert.match(race,/function returnToLobby\(\)/);
});

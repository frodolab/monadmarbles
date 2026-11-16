import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOnchainRoom, formatWei, testnetExplorerTx, registrationMessage } from '../src/paid.js';

const address='0xa8149453bbd015a470bcd0fa572ea154aeb6c869';
const room={
  demoOnly:false,course:'v27',phase:'lobby',maxPlayers:48,entries:[],
  blockchain:{
    mode:'onchain',status:'open',chainId:10143,contractAddress:address,
    autoPayoutEnabled:true,synced:true,chainRaceId:'12',
    entryFeeWei:'100000000000000000',poolWei:'0',
    capacity:48,
  },
};

test('paid entry requires pinned V2 contract and automatic settlement',()=>{
  assert.equal(validateOnchainRoom(room,true,address),address);
  assert.throws(()=>validateOnchainRoom(room,true,'0x1111111111111111111111111111111111111111'),/not pinned/);
  assert.throws(()=>validateOnchainRoom({...room,demoOnly:true},true,address),/FREE preview/);
  assert.throws(()=>validateOnchainRoom({...room,course:'classic'},true,address),/V27 physics/);
  assert.throws(()=>validateOnchainRoom({...room,blockchain:{...room.blockchain,autoPayoutEnabled:false}},true,address),/Automatic settlement/);
  assert.throws(()=>validateOnchainRoom({...room,blockchain:{...room.blockchain,chainId:1}},true,address),/Monad Testnet/);
  assert.throws(()=>validateOnchainRoom({...room,blockchain:{...room.blockchain,synced:false}},true,address),/not open/);
  assert.throws(()=>validateOnchainRoom({...room,entries:Array.from({length:48},(_,i)=>({id:i}))},true,address),/full/);
  assert.throws(()=>validateOnchainRoom({...room,blockchain:{...room.blockchain,entryFeeWei:'0'}},true,address),/invalid/);
  assert.throws(()=>validateOnchainRoom({...room,blockchain:{...room.blockchain,contractAddress:'0x'+'1'.repeat(40)}},true,address),/not pinned/);
});
test('wei displays the actual contract pool and not a hardcoded .1 fee',()=>{
  assert.equal(formatWei('1234000000000000000'),'1.234');
  assert.equal(formatWei('100000000000000000'),'0.1');
  assert.equal(formatWei('0'),'0');
  assert.equal(formatWei('oops'),'?');
});
test('only canonical tx hash produces blockchain explorer URL',()=>{
  assert.equal(testnetExplorerTx('0x'+'a'.repeat(64)),'https://testnet.monadexplorer.com/tx/0x'+'a'.repeat(64));
  assert.equal(testnetExplorerTx('javascript:alert(1)'),null);
});

test('a saved nickname uses the exact EIP-191 message verified by the server',()=>{
  const tx='0x'+'A'.repeat(64);
  const message=registrationMessage({
    raceId:'2',txHash:tx,nickname:'Marble King',contractAddress:address.toUpperCase().replace(/^0X/,'0x'),
  });
  assert.equal(message,[
    'Monad Marbles Testnet Registration',
    'Chain: 10143',
    'Contract: '+address,
    'Race: 2',
    'Transaction: '+tx.toLowerCase(),
    'Nickname: Marble King',
    'I authorize this nickname to be associated with my verified race entry.',
  ].join('\n'));
});

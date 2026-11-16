import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTerrain, buildSweep, findRoute, isSafe, distance, simulatedCoordinates} from './navigation.mjs';
test('world generation is deterministic and starts on safe ground', () => {
  assert.deepEqual(buildTerrain(3427), buildTerrain(3427));
  assert.ok(isSafe({x:-108,z:-108}, buildTerrain(3427).craters));
});
test('every ice deposit is outside crater exclusion zones', () => {
  const {craters,deposits} = buildTerrain();
  assert.equal(deposits.length,15);
  for (const p of deposits) assert.ok(isSafe(p,craters,4));
});
test('A* path never enters a crater and corners do not clip', () => {
  const {craters} = buildTerrain();
  const destinations = [{x:95,z:-95},{x:90,z:88},{x:-90,z:95},{x:0,z:0}];
  for (const target of destinations) {
    const path = findRoute({x:-108,z:-108},target,craters);
    assert.ok(path.length>0, 'route must exist');
    for (const p of path) assert.ok(isSafe(p,craters), 'path enters crater: '+JSON.stringify(p));
    for(let i=1;i<path.length;i++) assert.ok(distance(path[i],path[i-1]) <= 6, 'route step too large');
  }
});
test('coverage sweep includes many safe waypoints throughout the sector',()=>{
  const {craters}=buildTerrain();
  const sweep=buildSweep(craters);
  assert.ok(sweep.length>180);
  for(const p of sweep) assert.ok(isSafe(p,craters,5));
});
test('coordinates are in lunar latitude/longitude bounds',()=>{
  for(const p of [{x:-120,z:-120},{x:120,z:120}]) {
    const {latitude,longitude}=simulatedCoordinates(p);
    assert.ok(Math.abs(latitude)<90 && Math.abs(longitude)<180);
  }
});

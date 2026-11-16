import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { WORLD_SIZE, buildTerrain, buildSweep, findRoute, isSafe, distance, simulatedCoordinates, seededRandom } from './navigation.mjs';
import { connectWallet, sendDiscovery, EXPLORER } from './chain.js';
import './style.css';

const $ = id => document.getElementById(id);
const TARGET = 8;
const UNIT_TO_KM = 0.01; // 240 world units = 2.4 km
const SPEED = 11; // world units per simulation second
const START = { x:-108, z:-108 };
const { craters, deposits } = buildTerrain(3427);
const waypoints = buildSweep(craters);
const random = seededRandom(1387);
const worldHalf = WORLD_SIZE / 2;
const sceneEl = $('scene');
const sim = {
  x:START.x, z:START.z, heading:Math.PI/2, totalDistance:0, elapsed:0, speed:1,
  running:true, completed:false, discovered:[], path:[], route:[], routeIndex:0, sweepIndex:0,
  totalVisited:0, avoided:new Set(), alertCrater:null, activeHighView:false,
  missionId:String(Date.now()), chainEnabled:false, wallet:null, queue:[], busy:false,
  contract:import.meta.env.VITE_CONTRACT_ADDRESS || '', recordState:null
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070d19);
scene.fog = new THREE.FogExp2(0x121721, 0.004);
const camera = new THREE.PerspectiveCamera(59, 1, .15, 740);
const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:false});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
sceneEl.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0x9cc0e5,0x1c1d22,1.8));
const sunlight = new THREE.DirectionalLight(0xffeee0,2.8);
sunlight.position.set(-82,115,-62);sunlight.castShadow=true;
sunlight.shadow.mapSize.set(2048,2048);
sunlight.shadow.camera.left=-125;sunlight.shadow.camera.right=125;
sunlight.shadow.camera.top=125;sunlight.shadow.camera.bottom=-125;
sunlight.shadow.normalBias=.035;
scene.add(sunlight);
const fillLight = new THREE.DirectionalLight(0x8ab7ea,.55);
fillLight.position.set(70,40,100);scene.add(fillLight);

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function terrainHeight(x,z){
  let h= .75*Math.sin(x*.087)*Math.cos(z*.066)+.48*Math.sin(x*.22+z*.11)+.28*Math.cos(z*.34-x*.18);
  for(const c of craters){
    const d=Math.hypot(x-c.x,z-c.z);
    const ratio=d/c.radius;
    if(ratio < 1.5){
      h -= c.depth * Math.exp(-Math.pow(ratio/.66,4));
      h += c.depth*.42*Math.exp(-Math.pow((ratio-1.02)/.14,2));
    }
  }
  return h;
}
function surfaceY(x,z){return terrainHeight(x,z)+.14;}
function makeMaterial(color,metalness=.0,roughness=.9){return new THREE.MeshStandardMaterial({color,metalness,roughness});}
function mesh(geometry,material,parent,position=[0,0,0]){
  const m=new THREE.Mesh(geometry,material);m.position.set(...position);
  m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function addLine(points,color,opacity=.8){const g=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));const line=new THREE.Line(g,new THREE.LineBasicMaterial({color,transparent:true,opacity}));scene.add(line);return line;}

// Displaced lunar regolith: procedural heightfield with embedded crater basins.
const terrainGeom = new THREE.PlaneGeometry(WORLD_SIZE+80,WORLD_SIZE+80,220,220);
terrainGeom.rotateX(-Math.PI/2);
const pos=terrainGeom.attributes.position;
const colors=[];
for(let i=0;i<pos.count;i++){
  const x=pos.getX(i),z=pos.getZ(i),h=terrainHeight(x,z);
  pos.setY(i,h);
  let base=.34+.085*Math.sin(x*.23+z*.48)*Math.cos(z*.07-x*.16)+.07*Math.sin(x*.6)*Math.cos(z*.41);
  for(const c of craters){const d=Math.hypot(x-c.x,z-c.z);if(d<c.radius*.85)base-=.10*(1-d/(c.radius*.85));}
  base=clamp(base,.20,.56);
  colors.push(base*.90,base*.94,base*1.00);
}
terrainGeom.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
terrainGeom.computeVertexNormals();
const terrain=mesh(terrainGeom,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,flatShading:false}),scene);
terrain.castShadow=false;

// Fine surface pebbles, stars and distant highlands for texture and depth.
const pebbleGeo=new THREE.DodecahedronGeometry(1,0);
const pebbleMat=makeMaterial(0x8a939b);
const pebbles=new THREE.InstancedMesh(pebbleGeo,pebbleMat,840);
const dummy=new THREE.Object3D();
for(let i=0;i<840;i++){
  const x=(random()-.5)*315,z=(random()-.5)*315;
  const s=.09+random()*.24;
  dummy.position.set(x,surfaceY(x,z)+.03,z);dummy.scale.set(s*1.8,s*.5,s*1.3);
  dummy.rotation.set(random()*.5,random()*6.28,random()*.3);dummy.updateMatrix();pebbles.setMatrixAt(i,dummy.matrix);
}
pebbles.instanceMatrix.needsUpdate=true;pebbles.castShadow=false;pebbles.receiveShadow=true;scene.add(pebbles);
const starsGeo=new THREE.BufferGeometry();const stars=[];
for(let i=0;i<420;i++){
  const angle=random()*Math.PI*2,elevation=.1+random()*.9,rad=340;
  stars.push(Math.sin(angle)*rad,60+elevation*130,Math.cos(angle)*rad);
}
starsGeo.setAttribute('position',new THREE.Float32BufferAttribute(stars,3));
scene.add(new THREE.Points(starsGeo,new THREE.PointsMaterial({color:0xd6e6fa,size:1.1,sizeAttenuation:false,transparent:true,opacity:.9})));

// Semi-transparent bright red crater rims are also collision boundaries in A*.
const dangerRings=[];
for(const c of craters){
  const ringPoints=[];
  const outerPoints=[];
  for(let i=0;i<=96;i++){
    const a=i/96*Math.PI*2;
    const x=c.x+Math.cos(a)*(c.radius+1.9),z=c.z+Math.sin(a)*(c.radius+1.9);
    ringPoints.push(new THREE.Vector3(x,surfaceY(x,z)+.34,z));
    const xo=c.x+Math.cos(a)*(c.radius+4.3),zo=c.z+Math.sin(a)*(c.radius+4.3);
    outerPoints.push(new THREE.Vector3(xo,surfaceY(xo,zo)+.14,zo));
  }
  const material=new THREE.LineBasicMaterial({color:0xfa4d69,transparent:true,opacity:.71,depthWrite:false});
  const ring=new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPoints),material);
  const outer=new THREE.Line(new THREE.BufferGeometry().setFromPoints(outerPoints),new THREE.LineBasicMaterial({color:0xd83e59,transparent:true,opacity:.19,depthWrite:false}));
  scene.add(ring,outer);
  const beams=[];
  for(let b=0;b<6;b++){
    const a=b/6*Math.PI*2;
    const bx=c.x+Math.cos(a)*(c.radius+2),bz=c.z+Math.sin(a)*(c.radius+2);
    beams.push(new THREE.Vector3(bx,surfaceY(bx,bz)+.4,bz),new THREE.Vector3(bx,surfaceY(bx,bz)+2.3,bz));
  }
  const beamGeo=new THREE.BufferGeometry().setFromPoints(beams);
  scene.add(new THREE.LineSegments(beamGeo,new THREE.LineBasicMaterial({color:0xe85d6a,transparent:true,opacity:.31})));
  dangerRings.push({crater:c,material});
}

// Rover, composed entirely of runtime geometry: chassis, wheels, camera, solar arrays, antenna.
const rover=new THREE.Group();scene.add(rover);
const matte=makeMaterial(0xe7e3d3,.45,.45),dark=makeMaterial(0x242d35,.35,.78),darkMetal=makeMaterial(0x384651,.75,.42),gold=makeMaterial(0xd2a77a,.64,.4);
const blueSolar=new THREE.MeshStandardMaterial({color:0x174963,metalness:.7,roughness:.27,emissive:0x041e2d,emissiveIntensity:.36});
mesh(new THREE.BoxGeometry(3.5,.8,4.9),matte,rover,[0,2.2,0]);
mesh(new THREE.BoxGeometry(3.1,.24,4.4),darkMetal,rover,[0,2.74,0]);
mesh(new THREE.BoxGeometry(2.3,.36,2.8),gold,rover,[0,3,0]);
for(const side of [-1,1]){
  const solarFrame=mesh(new THREE.BoxGeometry(2.7,.12,4.3),darkMetal,rover,[side*3.05,2.4,0]);
  solarFrame.rotation.z=side*.05;
  const panel=mesh(new THREE.BoxGeometry(2.48,.06,4.02),blueSolar,rover,[side*3.05,2.5,0]);
  panel.rotation.z=side*.05;
  for(let j=-1;j<=1;j++)mesh(new THREE.BoxGeometry(.045,.07,4.04),makeMaterial(0xacc3cb,.4,.38),rover,[side*3.05+j*.78,2.56,0]);
  for(let j=-1;j<=1;j++)mesh(new THREE.BoxGeometry(2.45,.07,.035),makeMaterial(0xacc3cb,.4,.38),rover,[side*3.05,2.56,j*1.25]);
}
const wheelMaterial=makeMaterial(0x202629,.05,.93);
const wheelHub=makeMaterial(0x9baeb4,.7,.45);
const wheels=[];
for(const side of [-1,1])for(const z of [-2.05,0,2.05]){
  const pivot=new THREE.Group();pivot.position.set(side*2.05,1.13,z);rover.add(pivot);
  mesh(new THREE.CylinderGeometry(.72,.72,.53,16),wheelMaterial,pivot).rotation.z=Math.PI/2;
  mesh(new THREE.CylinderGeometry(.31,.31,.55,16),wheelHub,pivot).rotation.z=Math.PI/2;
  for(let t=0;t<12;t++){
    const a=t*Math.PI/6;
    const tread=mesh(new THREE.BoxGeometry(.62,.13,.19),darkMetal,pivot,[0,Math.sin(a)*.7,Math.cos(a)*.7]);
    tread.rotation.x=-a;
  }
  wheels.push(pivot);
  mesh(new THREE.CylinderGeometry(.13,.13,1.25,8),darkMetal,rover,[side*1.72,1.68,z]).rotation.z=Math.PI*.28*side;
}
const mast=mesh(new THREE.CylinderGeometry(.11,.17,2,9),darkMetal,rover,[0,4.15,-.9]);
mesh(new THREE.BoxGeometry(.95,.65,.43),matte,rover,[0,5.24,-1.03]);
for(const side of [-1,1]){
  mesh(new THREE.CylinderGeometry(.19,.19,.22,18),makeMaterial(0x67bdd5,.25,.2),rover,[side*.28,5.25,-1.32]).rotation.x=Math.PI/2;
}
const dishJoint=new THREE.Group();dishJoint.position.set(1.15,3.36,1.25);rover.add(dishJoint);
mesh(new THREE.CylinderGeometry(.06,.06,1.3,10),darkMetal,dishJoint,[0,.65,0]);
const dish=mesh(new THREE.ConeGeometry(.77,.24,24,1,true),matte,dishJoint,[0,1.42,0]);dish.rotation.x=Math.PI;
mesh(new THREE.SphereGeometry(.11,8,8),gold,dishJoint,[0,1.48,0]);
const antenna=mesh(new THREE.CylinderGeometry(.025,.025,1.9,7),darkMetal,rover,[-1.1,3.84,1.15]);
mesh(new THREE.SphereGeometry(.16,8,8),new THREE.MeshBasicMaterial({color:0x88fbe1}),rover,[-1.1,4.84,1.15]);
const headlights=[];
for(const x of [-1.2,1.2])headlights.push(mesh(new THREE.BoxGeometry(.55,.26,.15),new THREE.MeshBasicMaterial({color:0xd3ecfa}),rover,[x,2.43,-2.54]));
rover.position.set(sim.x,surfaceY(sim.x,sim.z),sim.z);
rover.rotation.y=sim.heading;

// A spinning lidar beam and its ground footprint follow the autopilot.
const scanGroup=new THREE.Group();scene.add(scanGroup);
const radarCircle=new THREE.Mesh(new THREE.RingGeometry(8.9,9.03,90),new THREE.MeshBasicMaterial({color:0x72ebda,transparent:true,opacity:.39,side:THREE.DoubleSide,depthWrite:false}));
radarCircle.rotation.x=-Math.PI/2;scanGroup.add(radarCircle);
const scanner=new THREE.Mesh(new THREE.CircleGeometry(9,50,0,.59),new THREE.MeshBasicMaterial({color:0x46ddc9,transparent:true,opacity:.065,side:THREE.DoubleSide,depthWrite:false}));
scanner.rotation.x=-Math.PI/2;scanGroup.add(scanner);

// Discovered ice gets a 3D beacon and cyan sample field.
const beaconGroups=new Map();
function createBeacon(p){
  const group=new THREE.Group();group.position.set(p.x,surfaceY(p.x,p.z),p.z);scene.add(group);
  const base=mesh(new THREE.CylinderGeometry(1.35,1.35,.12,28),new THREE.MeshBasicMaterial({color:0x4cc5e0,transparent:true,opacity:.58}),group,[0,.08,0]);
  const glow=mesh(new THREE.SphereGeometry(1.05,12,10),new THREE.MeshBasicMaterial({color:0xa7f8ff,transparent:true,opacity:.32}),group,[0,.85,0]);
  const ice=mesh(new THREE.IcosahedronGeometry(.95,0),new THREE.MeshStandardMaterial({color:0x86e4f3,metalness:.25,roughness:.16,emissive:0x30b8db,emissiveIntensity:.42}),group,[0,.88,0]);
  ice.rotation.z=.25;
  const shaft=mesh(new THREE.CylinderGeometry(.03,.03,6,7),new THREE.MeshBasicMaterial({color:0x90f5ff,transparent:true,opacity:.65}),group,[0,4.1,0]);
  const ring=mesh(new THREE.TorusGeometry(1.65,.045,6,40),new THREE.MeshBasicMaterial({color:0x8cf0f9}),group,[0,6.95,0]);ring.rotation.x=Math.PI/2;
  beaconGroups.set(p.id,{group,ice,ring});
}

const trackGeometry=new LineGeometry();
const trailMaterial=new LineMaterial({color:0xff4a64,linewidth:4.5,transparent:true,opacity:1,depthTest:true});
const trail=new Line2(trackGeometry,trailMaterial);
trail.computeLineDistances();trail.frustumCulled=false;scene.add(trail);
function updateTrail(){
  const coords=[];
  const pts=sim.path;
  if(pts.length===1)pts.push({...pts[0],x:pts[0].x+.01});
  for(const p of pts)coords.push(p.x,surfaceY(p.x,p.z)+.24,p.z);
  trail.geometry.dispose();trail.geometry=new LineGeometry();trail.geometry.setPositions(coords);
  trail.computeLineDistances();
}
const routeMat=new THREE.LineDashedMaterial({color:0x78d8d2,transparent:true,opacity:.53,dashSize:2.5,gapSize:1.4});
let routeGuide=null;
function updateRouteGuide(){
  if(routeGuide){scene.remove(routeGuide);routeGuide.geometry.dispose();routeGuide=null;}
  const points=[{x:sim.x,z:sim.z},...sim.route.slice(sim.routeIndex,sim.routeIndex+35)];
  if(points.length<2)return;
  routeGuide=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p.x,surfaceY(p.x,p.z)+.3,p.z))),routeMat);
  routeGuide.computeLineDistances();scene.add(routeGuide);
}

const mapCanvas=$('minimap'),mapCtx=mapCanvas.getContext('2d');
const visited=new Set();
function explore(x,z){
  const cx=Math.floor((x+worldHalf)/8),cz=Math.floor((z+worldHalf)/8);
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
    const gx=cx+dx,gz=cz+dz;
    if(gx>=0&&gx<30&&gz>=0&&gz<30)visited.add(`${gx},${gz}`);
  }
  sim.totalVisited=visited.size;
}
function drawMap(){
  const ctx=mapCtx,w=mapCanvas.width,h=mapCanvas.height;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#0a1722';ctx.fillRect(0,0,w,h);
  const scale=2.04,ox=w/2-sim.x*scale,oz=h/2-sim.z*scale;
  const xy=(x,z)=>[ox+x*scale,oz+z*scale];
  ctx.save();ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
  ctx.strokeStyle='#1e3841';ctx.lineWidth=1;
  for(let x=-120;x<=120;x+=16){const a=xy(x,-120),b=xy(x,120);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
  for(let z=-120;z<=120;z+=16){const a=xy(-120,z),b=xy(120,z);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
  ctx.strokeStyle='#34515c';ctx.lineWidth=2;ctx.strokeRect(...xy(-120,-120),240*scale,240*scale);
  for(const c of craters){const [cx,cy]=xy(c.x,c.z);ctx.beginPath();ctx.arc(cx,cy,c.radius*scale,0,2*Math.PI);ctx.strokeStyle=sim.alertCrater?.id===c.id?'#ff8695':'#cc4257';ctx.lineWidth=sim.alertCrater?.id===c.id?3:2;ctx.stroke();ctx.fillStyle='#912d4127';ctx.fill();}
  if(sim.path.length>1){ctx.beginPath();sim.path.forEach((p,i)=>{const coords=xy(p.x,p.z);if(i===0)ctx.moveTo(...coords);else ctx.lineTo(...coords)});ctx.strokeStyle='#fc576c';ctx.lineWidth=2.2;ctx.stroke();}
  if(sim.route.length>1){ctx.beginPath();for(let i=sim.routeIndex;i<sim.route.length;i++){const coords=xy(sim.route[i].x,sim.route[i].z);i===sim.routeIndex?ctx.moveTo(...xy(sim.x,sim.z)):null;ctx.lineTo(...coords)}ctx.strokeStyle='#88d4c17e';ctx.lineWidth=1.4;ctx.setLineDash([6,7]);ctx.stroke();ctx.setLineDash([]);}
  for(const p of sim.discovered){const [x,y]=xy(p.x,p.z);ctx.fillStyle='#91f5ff';ctx.shadowColor='#81e8fb';ctx.shadowBlur=10;ctx.beginPath();ctx.arc(x,y,5,0,2*Math.PI);ctx.fill();ctx.shadowBlur=0;}
  const [cx,cy]=xy(sim.x,sim.z);
  ctx.save();ctx.translate(cx,cy);ctx.rotate(sim.heading);ctx.fillStyle='#edfff6';ctx.shadowColor='#d5fef1';ctx.shadowBlur=12;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(7,9);ctx.lineTo(0,5);ctx.lineTo(-7,9);ctx.closePath();ctx.fill();ctx.restore();
  ctx.strokeStyle='#6ce1b34c';ctx.beginPath();ctx.arc(cx,cy,9*scale,0,2*Math.PI);ctx.stroke();
  ctx.restore();
  ctx.strokeStyle='#6b9d9a';ctx.fillStyle='#b2d8d6';ctx.font='11px DM Mono, monospace';
  ctx.fillText('N',w-18,22);ctx.beginPath();ctx.moveTo(w-14,28);ctx.lineTo(w-19,36);ctx.lineTo(w-9,36);ctx.closePath();ctx.fill();
}

function notify(message,ms=3000){
  const toast=$('toast');toast.textContent=message;toast.classList.remove('hidden');
  clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.classList.add('hidden'),ms);
}
function updateTelemetry(){
  $('deposit-count').textContent=String(sim.discovered.length).padStart(2,'0');
  $('deposit-progress').style.width=(sim.discovered.length/TARGET*100)+'%';
  $('coverage').textContent=(sim.totalVisited/900*100).toFixed(1);
  $('distance').textContent=(sim.totalDistance*UNIT_TO_KM).toFixed(2);
  $('velocity').textContent=sim.running&&!sim.completed?(SPEED*sim.speed).toFixed(1):'0.0';
  $('avoid-count').textContent=String(sim.avoided.size).padStart(2,'0');
  $('elapsed').textContent=formatElapsed(sim.elapsed);
  $('system-status').textContent=sim.completed?'MISSION COMPLETE':sim.running?'AUTONOMOUS NAVIGATION ONLINE':'SIMULATION PAUSED';
  $('avoid-label').textContent=sim.alertCrater?`⚠ CRATER ${String(sim.alertCrater.id).padStart(2,'0')} · AVOIDANCE ACTIVE`:'PATH CLEAR · ROUTE OPTIMIZED';
  $('avoid-label').classList.toggle('warning',!!sim.alertCrater);
  $('mission-state').innerHTML=sim.completed?'<i></i> TARGET REACHED':sim.running?'<i></i> EXPLORING SECTOR':'<i></i> SIMULATION PAUSED';
}
function formatElapsed(seconds){const n=Math.floor(seconds);return `${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
const ledger=[];
function updateLedger(){
  const confirmed=ledger.filter(l=>l.status==='confirmed').length;
  $('chain-count').textContent=`${confirmed} ON-CHAIN`;
  const wrap=$('events');
  if(!ledger.length){wrap.innerHTML='<div class="event-empty"><div class="empty-icon">◇</div><strong>NO DEPOSITS LOGGED</strong><span>Autonomous scan is running.<br/>Discoveries will appear here.</span></div>';return;}
  wrap.innerHTML=ledger.map(l=>{
    const status=l.status==='confirmed'?'CONFIRMED':l.status==='pending'?'AWAITING CHAIN':l.status==='failed'?'TX FAILED':l.status==='queued'?'QUEUED':'LOCAL ONLY';
    const info=l.txHash?`<a class="event-tx" href="${EXPLORER}/tx/${escapeHtml(l.txHash)}" target="_blank" rel="noopener noreferrer">TX ${escapeHtml(l.txHash.slice(0,14))}… ↗</a>`:`<div class="event-tx ${escapeHtml(l.status)}">${status}</div>`;
    return `<div class="event-item"><div class="event-icon">✳</div><div class="event-content"><div class="event-name">ICE POINT #${String(l.point.id).padStart(2,'0')} <span>${status}</span></div><div class="event-coordinates">${l.lat.toFixed(5)}° / ${l.lon.toFixed(5)}° · ${(l.point.confidence/100).toFixed(1)}% SIM</div>${info}</div></div>`;
  }).reverse().join('');
}
function addDiscovery(point){
  sim.discovered.push(point);
  createBeacon(point);
  const {latitude,longitude}=simulatedCoordinates(point);
  const entry={point,lat:latitude,lon:longitude,missionId:sim.missionId,status:'local',txHash:null};
  ledger.push(entry);
  if(sim.chainEnabled){entry.status='queued';sim.queue.push(entry);processQueue();}
  updateLedger();
  notify(`✳  ICE SIGNATURE IDENTIFIED  /  POINT ${String(point.id).padStart(2,'0')} MARKED`,4200);
  if(sim.discovered.length>=TARGET)finishMission('TARGET REACHED');
}
async function processQueue(){
  if(sim.busy||!sim.chainEnabled||!sim.queue.length)return;
  sim.busy=true;
  while(sim.queue.length&&sim.chainEnabled){
    const entry=sim.queue.shift();
    if(entry.status==='confirmed')continue;
    entry.status='pending';updateLedger();
    try{
      const tx=await sendDiscovery({address:sim.contract,missionId:entry.missionId,deposit:entry.point,latitude:entry.lat,longitude:entry.lon});
      entry.txHash=tx.hash;updateLedger();
      const receipt=await tx.wait();
      if(receipt?.status!==1)throw new Error('Transaction reverted');
      entry.status='confirmed';notify(`✓ MONAD TESTNET TX CONFIRMED · POINT ${entry.point.id}`);
    }catch(error){
      entry.status='failed';
      console.warn('On-chain marker failed:',error);
      notify(`ON-CHAIN MARKER FAILED · ${String(error.shortMessage||error.message).slice(0,80)}`,5300);
      // A rejected wallet prompt pauses auto-sends, avoiding repeated unsolicited prompts.
      sim.chainEnabled=false;$('onchain-toggle').checked=false;
      for(const pending of sim.queue)if(pending.status==='queued')pending.status='local';
      sim.queue=[];
    }
    updateLedger();
  }
  sim.busy=false;
}
function finishMission(reason){
  sim.completed=true;sim.running=false;$('play-pause').textContent='▶';
  $('mission-banner').classList.remove('hidden');
  $('mission-banner').querySelector('span').textContent=reason==='TARGET REACHED'?`${TARGET} simulated deposits mapped. Blockchain confirmations may still be pending.`:'Exploration grid completed; no more safe waypoints.';
  updateTelemetry();
}
function selectRoute(){
  while(sim.sweepIndex<waypoints.length){
    const goal=waypoints[sim.sweepIndex++];
    if(distance({x:sim.x,z:sim.z},goal)<3.5)continue;
    const route=findRoute({x:sim.x,z:sim.z},goal,craters);
    if(route.length){sim.route=route;sim.routeIndex=0;updateRouteGuide();return true;}
  }
  finishMission('SECTOR COMPLETED');return false;
}
function integrate(dt){
  if(!sim.route.length||sim.routeIndex>=sim.route.length){if(!selectRoute())return;}
  let remaining=SPEED*dt;
  let moved=0;
  while(remaining>0.0001){
    if(sim.routeIndex>=sim.route.length){sim.route=[];break;}
    const next=sim.route[sim.routeIndex];
    const dx=next.x-sim.x,dz=next.z-sim.z,dist=Math.hypot(dx,dz);
    if(dist<.1){sim.routeIndex++;continue;}
    const step=Math.min(dist,remaining);
    const nx=sim.x+dx/dist*step,nz=sim.z+dz/dist*step;
    if(!isSafe({x:nx,z:nz},craters,3.3)){
      sim.route=[];sim.routeIndex=0;notify('AUTONOMOUS SAFETY: OBSTACLE ROUTE RECOMPUTED');break;
    }
    sim.x=nx;sim.z=nz;sim.heading=Math.atan2(dx, -dz);
    remaining-=step;moved+=step;
    if(step>=dist-.05)sim.routeIndex++;
    if(moved>60)break;
  }
  sim.totalDistance+=moved;sim.elapsed+=dt;
  explore(sim.x,sim.z);
  const last=sim.path[sim.path.length-1];
  if(!last||distance(last,{x:sim.x,z:sim.z})>.8){
    sim.path.push({x:sim.x,z:sim.z});
    if(sim.path.length%3===0)updateTrail();
  }
  for(const point of deposits){
    if(!sim.discovered.some(p=>p.id===point.id) && distance({x:sim.x,z:sim.z},point)<=9.2){addDiscovery(point);if(sim.completed)break;}
  }
  const near=craters.map(c=>({c,d:distance(c,{x:sim.x,z:sim.z})-(c.radius+3.7)})).sort((a,b)=>a.d-b.d)[0];
  sim.alertCrater=near?.d<12?near.c:null;
  if(sim.alertCrater)sim.avoided.add(sim.alertCrater.id);
  if(sim.path.length%8===0&&sim.path.length>0)updateRouteGuide();
}

function resetMission(){
  // Do not delete submitted on-chain entries; they remain in the ledger and on-chain.
  sim.x=START.x;sim.z=START.z;sim.heading=Math.PI/2;sim.totalDistance=0;sim.elapsed=0;sim.running=true;sim.completed=false;
  sim.discovered=[];sim.path=[{x:sim.x,z:sim.z}];sim.route=[];sim.routeIndex=0;sim.sweepIndex=0;sim.avoided=new Set();sim.alertCrater=null;sim.missionId=String(Date.now());
  visited.clear();explore(sim.x,sim.z);
  for(const {group} of beaconGroups.values())scene.remove(group);
  beaconGroups.clear();
  // Previous mission entries intentionally remain in ledger (including confirmed tx links).
  $('mission-banner').classList.add('hidden');$('play-pause').textContent='❚❚';
  updateTrail();updateRouteGuide();updateTelemetry();
  notify('MISSION RESTARTED · AUTONOMOUS SWEEP INITIALIZED');
}

const captureCanvas=document.createElement('canvas');captureCanvas.width=1280;captureCanvas.height=720;
const captureCtx=captureCanvas.getContext('2d',{alpha:false});
let recorder=null,recordedChunks=[];
function paintCapture(){
  const c=captureCtx,W=1280,H=720;
  c.fillStyle='#050c14';c.fillRect(0,0,W,H);
  c.drawImage(renderer.domElement,0,0,W,H);
  const fade=c.createLinearGradient(0,0,0,165);fade.addColorStop(0,'#05101dcc');fade.addColorStop(1,'#05101d00');c.fillStyle=fade;c.fillRect(0,0,W,165);
  c.fillStyle='#a1efcf';c.font='bold 19px Inter, sans-serif';c.fillText('SELENE   /   ICE SCOUT 01',30,45);
  c.font='14px monospace';c.fillStyle='#d6e7ea';c.fillText('AUTONOMOUS LUNAR ICE PROSPECTING  •  SYNTHETIC MISSION',30,73);
  c.fillStyle='#bdfbe2';c.font='bold 16px monospace';c.fillText(`${sim.discovered.length} / ${TARGET} ICE POINTS`,30,H-63);
  c.font='13px monospace';c.fillStyle='#d3e4ed';c.fillText(`SPEED ${sim.speed}×   |   DISTANCE ${(sim.totalDistance*.01).toFixed(2)} KM   |   MISSION ${formatElapsed(sim.elapsed)}`,30,H-37);
  c.drawImage(mapCanvas,W-306,H-250,275,183);
  c.font='12px monospace';c.fillStyle='#bfe6dd';c.fillText('LIVE OVERHEAD MAP',W-306,H-260);
  c.font='10px monospace';c.fillStyle='#c6d1d9';c.fillText('MONAD TESTNET • USER-APPROVED TX ONLY',W-306,H-43);
  if(recorder?.state==='recording'){c.fillStyle='#ff7386';c.beginPath();c.arc(W-45,34,7,0,Math.PI*2);c.fill();c.fillStyle='#e6eaf1';c.font='bold 13px monospace';c.fillText('REC',W-97,38);}
}
function toggleRecord(){
  if(recorder?.state==='recording'){recorder.stop();return;}
  if(!captureCanvas.captureStream||!window.MediaRecorder){notify('VIDEO RECORDING NOT SUPPORTED IN THIS BROWSER');return;}
  const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));
  if(!mime){notify('WEBM RECORDING NOT SUPPORTED IN THIS BROWSER');return;}
  recordedChunks=[];
  recorder=new MediaRecorder(captureCanvas.captureStream(30),{mimeType:mime,videoBitsPerSecond:5_000_000});
  recorder.ondataavailable=e=>{if(e.data.size)recordedChunks.push(e.data)};
  recorder.onstop=()=>{
    const file=new Blob(recordedChunks,{type:mime});
    const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=`selene-mission-${sim.missionId}.webm`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    $('record').classList.remove('recording');$('record').innerHTML='<span class="record-dot"></span> RECORD VIDEO';notify('VIDEO SAVED AS WEBM');
  };
  recorder.start(1000);$('record').classList.add('recording');$('record').innerHTML='<span class="record-dot"></span> STOP RECORDING';notify('VIDEO CAPTURE STARTED · HUD AND MINIMAP INCLUDED');
}

async function handleWallet(){
  try{
    sim.wallet=await connectWallet();
    $('wallet-button').textContent=`⬡ ${sim.wallet.slice(0,6)}…${sim.wallet.slice(-4)}`;
    $('chain-dot').classList.add('connected');$('chain-label').textContent='WALLET CONNECTED';
    notify('METAMASK CONNECTED TO MONAD TESTNET');
  }catch(error){notify(String(error.shortMessage||error.message),5200);}
}
$('wallet-button').addEventListener('click',handleWallet);
$('save-contract').addEventListener('click',()=>{
  const value=$('contract-address').value.trim();
  if(value&&!/^0x[a-fA-F0-9]{40}$/.test(value)){notify('INVALID CONTRACT ADDRESS · EXPECTED 0x + 40 HEX CHARACTERS');return;}
  sim.contract=value;localStorage.setItem('selene-registry-address',value);notify(value?'REGISTRY ADDRESS CONFIGURED':'REGISTRY ADDRESS CLEARED');
});
$('onchain-toggle').addEventListener('change',async e=>{
  if(!e.target.checked){sim.chainEnabled=false;notify('ON-CHAIN AUTO-QUEUE DISABLED');return;}
  if(!sim.contract){e.target.checked=false;notify('DEPLOY CONTRACT AND SET ITS ADDRESS FIRST',4900);return;}
  if(!sim.wallet){await handleWallet();if(!sim.wallet){e.target.checked=false;return;}}
  sim.chainEnabled=true;
  for(const item of ledger)if(item.status==='local'||item.status==='failed') {item.status='queued';sim.queue.push(item);}
  updateLedger();processQueue();notify('ON-CHAIN QUEUE ENABLED · WALLET APPROVAL REQUIRED PER DISCOVERY',4500);
});
$('play-pause').addEventListener('click',()=>{
  if(sim.completed){resetMission();return;}
  sim.running=!sim.running;
  $('play-pause').textContent=sim.running?'❚❚':'▶';
  $('play-pause').setAttribute('aria-label',sim.running?'Pause simulation':'Resume simulation');
  updateTelemetry();
});
$('restart').addEventListener('click',resetMission);
document.querySelectorAll('.speed-btn').forEach(btn=>btn.addEventListener('click',()=>{
  sim.speed=Number(btn.dataset.speed);
  document.querySelectorAll('.speed-btn').forEach(b=>b.classList.toggle('active',b===btn));
  notify(`PLAYBACK SPEED ${sim.speed}×`);
}));
$('record').addEventListener('click',toggleRecord);
$('view-toggle').addEventListener('click',()=>{
  sim.activeHighView=!sim.activeHighView;
  $('view-toggle').textContent=sim.activeHighView?'◈ CHASE':'◈ VIEW';
  notify(sim.activeHighView?'ELEVATED TRACKING VIEW':'REAR CHASE CAMERA');
});
const storedAddress=localStorage.getItem('selene-registry-address')||sim.contract;
if(storedAddress){sim.contract=storedAddress;$('contract-address').value=storedAddress;}

let lastFrame=performance.now();let hudTimer=0;let captureTime=0;let cameraZoom=1;
sceneEl.addEventListener('wheel',e=>{e.preventDefault();cameraZoom=clamp(cameraZoom+Math.sign(e.deltaY)*.08,.55,2.3);},{passive:false});
window.addEventListener('resize',resize);
function resize(){
  const rect=sceneEl.getBoundingClientRect();
  if(rect.width<=0||rect.height<=0)return;
  camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();renderer.setSize(rect.width,rect.height,false);
  trailMaterial.resolution.set(rect.width,rect.height);
}
function render(time){
  requestAnimationFrame(render);
  const rawDt=Math.min((time-lastFrame)/1000,.055);lastFrame=time;
  if(sim.running&&!sim.completed){
    // Clamp each substep so high playback speeds don't leap through crater boundaries.
    let remaining=rawDt*sim.speed;
    while(remaining>.00001&&!sim.completed){const substep=Math.min(remaining,.06);integrate(substep);remaining-=substep;}
  }
  const y=surfaceY(sim.x,sim.z);
  rover.position.set(sim.x,y+.17,sim.z);
  const yaw=sim.heading;
  const dAngle=Math.atan2(Math.sin(yaw-rover.rotation.y),Math.cos(yaw-rover.rotation.y));
  rover.rotation.y+=dAngle*Math.min(1,rawDt*5);
  rover.rotation.z=Math.sin(time*.002)*.012;
  for(const wheel of wheels)wheel.rotation.x+=sim.running?rawDt*sim.speed*SPEED/.72:0;
  dishJoint.rotation.y=time*.00048;
  scanGroup.position.set(sim.x,y+.4,sim.z);
  scanner.rotation.z=-time*.0007;
  for(const c of dangerRings)c.material.opacity=sim.alertCrater?.id===c.crater.id ? .82+.18*Math.sin(time*.012) : .67;
  for(const [id,obj] of beaconGroups){obj.ice.rotation.y=time*.0006+id;obj.ring.position.y=6.95+Math.sin(time*.002+id)*.15;}
  const front=new THREE.Vector3(Math.sin(rover.rotation.y),0,-Math.cos(rover.rotation.y));
  const behind=front.clone().multiplyScalar(sim.activeHighView?-12:-18*cameraZoom);
  const height=sim.activeHighView?46*cameraZoom:10*cameraZoom;
  const desired=new THREE.Vector3(sim.x+behind.x,y+height,sim.z+behind.z);
  camera.position.lerp(desired,clamp(rawDt*3,0,1));
  camera.lookAt(sim.x,y+2.6,sim.z);
  renderer.render(scene,camera);
  hudTimer+=rawDt;captureTime+=rawDt;
  if(hudTimer>.12){updateTelemetry();drawMap();hudTimer=0;}
  if(recorder?.state==='recording'&&captureTime>=1/30){paintCapture();captureTime=0;}
}

sim.path.push({x:sim.x,z:sim.z});
explore(sim.x,sim.z);updateTrail();selectRoute();resize();updateTelemetry();drawMap();requestAnimationFrame(render);

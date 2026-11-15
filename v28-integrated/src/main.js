import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';

const root=document.querySelector('#app');
root.innerHTML=`<div id="scene"></div><div class="logo clean-race-logo" aria-label="Monad Marbles"><span class="race-monad">M<img src="/monad-symbol.png" alt="O"/>NAD</span> <span class="race-marbles">MARBLES</span></div><div class="pool" id="pool"><span class="pool-monad" aria-hidden="true"><span class="pool-monad-inner"></span></span><span class="race-pool-stack"><small>PRIZE POOL</small><strong id="poolValue">0.0 MON</strong><small id="count">0 ENTRIES</small><small class="race-preview-notice">LOCAL PREVIEW · NO DEPOSITS</small></span></div><div class="panel left" id="playerInfo"><h2>✨ YOUR MARBLE</h2><div id="myMarble">Loading racer…</div><p class="muted">Your marble is highlighted with a golden glow.</p><a href="/" class="back">← Back to lobby</a></div><div class="panel right"><div class="row"><h2>🏆 Top 5</h2><span class="muted" id="timer">LOBBY</span></div><div id="board" class="muted">Add racers to begin.</div></div><div class="actions" style="display:none"><button id="start">▶ START RACE</button><button class="pink" id="reset">↻ BACK TO LOBBY</button><span class="muted" id="phase">Waiting for racers</span></div><div class="camera-ui"><label for="cameraMode">🎥 CAMERA</label><select id="cameraMode"><option value="leaders">Follow leaders</option><option value="mine">Follow my marble</option><option value="wide">Wide cinematic</option></select></div><div class="toast" id="toast"></div><div class="finish" id="finish" role="dialog" aria-label="Race results"><div class="podium-header"><small>MONAD MARBLES · RACE RESULTS</small><h1>🏆 THE WINNER</h1><div class="winnings"><span>✦ FIRST PLACE ✦</span><strong id="winningAmount">0.0 MON</strong></div></div><div class="podium-bottom"><div class="podium-labels" id="podiumLabels"></div><div class="podium-actions"><p>Top three marbles · Preview · No actual payouts</p><button id="again">↻ NEW RACE</button></div></div></div>`;
const $=s=>document.querySelector(s), COLORS=['#ff5ba4','#ff914e','#ffdc55','#5ae6c0','#6092ff','#a582f5','#ef5d6d','#a7e66e','#ffb7a0','#e798ec','#76dbf4','#3c467b','#906cf1','#e7af40'];
const handoff=(()=>{try{return JSON.parse(sessionStorage.getItem('monadMarblesRace')||'null')}catch{return null}})();
const viewerId=handoff?.viewerMarbleId??handoff?.participants?.find(p=>!p.isBot)?.id??null;
const MAX=60, ENTRY=.1, R=.57, STEP=1/60, LENGTH=300, TRACK_WIDTH=13.5;
const SPINNER_SPEED=1.8, JUMP_AT=185, MAX_RACE_SECONDS=105;
let selected=0,players=[],phase='lobby',elapsed=0,finished=[],connected=null,world,gateBody,funnelVisual,trackObjects=[],obstacles=[],last=performance.now(),acc=0,frameCount=0,fpsTime=0,releaseTime=0;
// Preserve the five V34 visual themes; map choice changes color, not physics geometry.
const themeKey=['candy','midnight','moon','rainbow','castle'].includes(handoff?.theme)?handoff.theme:'candy';
const themePalette={
 candy:{sky:'#a5eddf',ground:'#91d9b6',track:'#fff0f8',edge:'#ff91c4',accent:'#79e7df',bump:'#ffe079'},
 midnight:{sky:'#25234f',ground:'#4c4d87',track:'#5b4c9b',edge:'#9b82e4',accent:'#74bfd8',bump:'#f7cf80'},
 moon:{sky:'#738ca4',ground:'#8aa5b1',track:'#dce4ee',edge:'#a7b8db',accent:'#aacdd6',bump:'#ffde87'},
 rainbow:{sky:'#b1d5fa',ground:'#78ddc7',track:'#ffdded',edge:'#ff8bbd',accent:'#8decd3',bump:'#ffe17f'},
 castle:{sky:'#b8a5ce',ground:'#b0a3bf',track:'#f4e1e8',edge:'#a88ac7',accent:'#86d7c5',bump:'#f5d78f'}
};
const palette=themePalette[themeKey];
document.body.dataset.theme=themeKey;
const scene=new THREE.Scene();scene.background=new THREE.Color(palette.sky);scene.fog=new THREE.Fog(palette.sky,130,360);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,650);camera.position.set(22,24,33);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.shadowMap.enabled=false;renderer.outputColorSpace=THREE.SRGBColorSpace;$('#scene').appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight('#ffffff','#9d81ca',2.35));const sunlight=new THREE.DirectionalLight('#ffffff',2.2);sunlight.position.set(-35,65,40);scene.add(sunlight);
const mat=(color,roughness=.53)=>new THREE.MeshStandardMaterial({color,roughness,metalness:.06});const cream=mat(palette.track),pink=mat(palette.edge),aqua=mat(palette.accent),yellow=mat(palette.bump),lavender=mat('#a38cf3'),earth=mat(palette.ground);
const boxGeo=new THREE.BoxGeometry(1,1,1),sphereGeo=new THREE.SphereGeometry(R,20,14),dummy=new THREE.Object3D();
function visualBox(size,pos,material,rot){const mesh=new THREE.Mesh(boxGeo,material);mesh.position.set(...pos);mesh.scale.set(...size);if(rot)mesh.quaternion.copy(rot);scene.add(mesh);return mesh}
function rigidBox(size,pos,material,rot=null,kinematic=false){const mesh=visualBox(size,pos,material,rot);const desc=kinematic?RAPIER.RigidBodyDesc.kinematicPositionBased():RAPIER.RigidBodyDesc.fixed();desc.setTranslation(...pos);if(rot)desc.setRotation(rot);const body=world.createRigidBody(desc);world.createCollider(RAPIER.ColliderDesc.cuboid(...size.map(v=>v/2)).setFriction(.75).setRestitution(.18),body);return {mesh,body}}
function trackCenter(s){return new THREE.Vector3(4*Math.sin(s*.028)+3*Math.sin(s*.075),3.5-.027*s,-s)}
function trackTangent(s){return trackCenter(Math.min(LENGTH,s+.25)).sub(trackCenter(Math.max(0,s-.25))).normalize()}
function trackSide(s){const t=trackTangent(s);return new THREE.Vector3(-t.z,0,t.x).normalize()}
function trackPoint(s,l=0,h=0){return trackCenter(s).addScaledVector(trackSide(s),l).add(new THREE.Vector3(0,h,0))}
function createTrack(){visualBox([220,2,720],[0,-14,-140],earth);const hillGeo=new THREE.ConeGeometry(1,1,7);const hills=new THREE.InstancedMesh(hillGeo,mat('#91cfb8'),50);for(let i=0;i<50;i++){const z=25-i*7,x=(i%2?-1:1)*(25+(i*13%18)),height=5+(i*7%12);dummy.position.set(x,-13+height/2,z);dummy.scale.set(5+(i*5%7),height,5+(i*5%7));dummy.updateMatrix();hills.setMatrixAt(i,dummy.matrix)}hills.instanceMatrix.needsUpdate=true;scene.add(hills);
// Each segment is an actual Rapier collider. No track-coordinate movement is imposed on racers.
const segments=90;for(let i=0;i<segments;i++){const s0=i*LENGTH/segments,s1=(i+1)*LENGTH/segments,a=trackCenter(s0),b=trackCenter(s1),mid=a.clone().add(b).multiplyScalar(.5),t=b.clone().sub(a).normalize(),rot=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),t),len=a.distanceTo(b)+.35;
rigidBox([TRACK_WIDTH,.65,len],[mid.x,mid.y-.35,mid.z],i%14<2?mat('#f8d3ee'):cream,rot);
for(const sign of [-1,1]){
 const side=trackSide((s0+s1)/2),p=mid.clone().addScaledVector(side,sign*(TRACK_WIDTH/2+.25));
 // V26: a full-height collision wall protects the complete course, while the
 // short pastel rail is the ONLY visible part. Same centerline avoids pockets.
 const barrier=rigidBox([.65,9.0,len],[p.x,p.y+4.1,p.z],i%12<6?pink:aqua,rot);
 barrier.mesh.scale.y=2.15;
 barrier.mesh.position.y=p.y+.65;
}
if(i%7===0){const supportHeight=Math.max(1,mid.y+13);visualBox([7,supportHeight,7],[mid.x,-13+supportHeight/2,mid.z],lavender)}
}
// Physical ramps: short raised inclines, followed by clear airborne sections.
for(const s of [48,117,194,263]){const p=trackPoint(s,0,.20),t=trackTangent(s),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),t);const incline=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.095);q.multiply(incline);rigidBox([TRACK_WIDTH-1,.25,7],[p.x,p.y,p.z],yellow,q)}
// V21: the former 1.65-high sweeper had 1.39 units of clearance under it,
// more than a 1.14-diameter marble: racers could pass underneath without contact.
// Place a compact arm at a collision-capable height and keep its Rapier and Three
// dimensions identical. The shorter arm leaves wide, unpinched outside lanes.
const SWEEPER_SIZE=[6.6,.70,.90], SWEEPER_HEIGHT=1.02;
for(const s of [25,87,153,227,281]){
 const p=trackPoint(s,0,SWEEPER_HEIGHT);
 const initialAngle=s*.13;
 const initialRotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),initialAngle);
 const pivot=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
  .setTranslation(p.x,p.y,p.z).setRotation(initialRotation));
 const collider=RAPIER.ColliderDesc.cuboid((SWEEPER_SIZE[0]-.70)/2,SWEEPER_SIZE[1]/2,SWEEPER_SIZE[2]/2)
  .setFriction(.18).setRestitution(.52);
 world.createCollider(collider,pivot);
 // Rounded capsule-like paddle: a shorter rectangle and hemispherical-looking end caps.
 // All three colliders belong to the same rotating Rapier body, so the caps collide too.
 const coreLength=SWEEPER_SIZE[0]-.70, capRadius=SWEEPER_SIZE[1]*.5;
 const capX=coreLength*.5;
 for(const sign of [-1,1])world.createCollider(RAPIER.ColliderDesc.ball(capRadius).setTranslation(sign*capX,0,0).setFriction(.18).setRestitution(.52),pivot);
 const mesh=new THREE.Group();mesh.position.copy(p);mesh.quaternion.copy(initialRotation);scene.add(mesh);
 const spinnerMaterial=s%2?pink:aqua;
 // V24: render the sweeper as one continuous rounded shape rather than a box with
 // small circular caps attached. A squashed capsule gives a cleaner single-form look.
 const capsule=new THREE.Mesh(new THREE.CapsuleGeometry(capRadius,coreLength,8,18),spinnerMaterial);
 capsule.rotation.z=Math.PI/2;
 capsule.scale.z=SWEEPER_SIZE[2]/(capRadius*2);
 mesh.add(capsule);
 obstacles.push({pivot,mesh,p,s,angle:initialAngle});
}
for(const s of [63,135,207,275])for(const lane of [-3.6,3.6]){const p=trackPoint(s,lane,1.05);const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x,p.y,p.z));world.createCollider(RAPIER.ColliderDesc.ball(1.05).setRestitution(.9),body);const mesh=new THREE.Mesh(new THREE.SphereGeometry(1.05,14,10),s%2?lavender:pink);mesh.position.copy(p);scene.add(mesh)}
// A broad, low jump ramp; an upward impulse at its lip makes the leap visible.
{const s=JUMP_AT,p=trackPoint(s,0,.43),t=trackTangent(s);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),t);q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.065));rigidBox([TRACK_WIDTH-1.5,.30,9],[p.x,p.y-.10,p.z],yellow,q);
 // Wide physical landing deck and invisible collision guards to preserve the spectator view.
 for(let k=0;k<11;k++){const at=s-8+k*4, center=trackPoint(at,0,-.10),t=trackTangent(at),rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),t);
 rigidBox([TRACK_WIDTH+3,.55,4.8],[center.x,center.y,center.z],aqua,rotation);
 for(const side of [-1,1]){const wall=trackPoint(at,side*(TRACK_WIDTH/2+1.65),3.65);const invisible=rigidBox([.7,9.0,4.8],[wall.x,wall.y,wall.z],pink,rotation);invisible.mesh.visible=false;}
 }}
// Physical checkered finish gate.
// V18: stagger center-lane slalom pillars instead of placing them near side walls.
// A single column at each distance leaves two wide escape lanes and avoids
// wedging 48-player traffic between a pillar and the outer guardrail.
for(const [s,lane] of [[39,-2.2],[51,2.2],[102,1.9],[114,-2.2],[169,-2.0],[181,2.0],[239,2.2],[251,-1.9]]) {
 const p=trackPoint(s,lane,.95);
 const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x,p.y,p.z));
 world.createCollider(RAPIER.ColliderDesc.cylinder(.95,.63).setFriction(.6).setRestitution(.5),body);
 const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.63,.63,1.9,20),s%2?pink:aqua);mesh.position.copy(p);scene.add(mesh);
}
for(let k=0;k<12;k++){const p=trackPoint(LENGTH-5,-5.5+k,.06);visualBox([1,.1,1.4],[p.x,p.y,p.z],k%2?mat('#2a2059'):mat('#ffffff'))}for(const l of [-7.3,7.3]){const p=trackPoint(LENGTH-5,l,4);visualBox([.8,8,.8],[p.x,p.y,p.z],lavender)}const arch=trackPoint(LENGTH-5,0,8.2);visualBox([15.8,1.1,1],[arch.x,arch.y,arch.z],yellow);
}
// V11: one continuous Rapier world, including the funnel and its open drain.
// The funnel is a triangle-mesh *collision surface*, not a visual-only decoration.
const bowlPos=new THREE.Vector3(0,0,-4), FUNNEL_R=12.7, OUTLET_R=2.95;
const FUNNEL_BOTTOM=7.7, FUNNEL_TOP=16.3;
const funnelGlass=new THREE.MeshPhysicalMaterial({color:'#d9faff',metalness:.06,roughness:.08,transparent:true,opacity:.30,side:THREE.DoubleSide,depthWrite:false,clearcoat:1});
let upperBowlBody=null,upperBowlMesh=null,upperTip=0;
function createUpperBowl(){
 // Separate elevated bowl. Rapier trimesh segments form the concave interior;
 // a kinematic rigid body rotates the bowl and its colliders together.
 const y0=23.0, offsetX=-3.6, segments=64, rings=14, rad=8.4;
 const verts=[],indices=[];
 for(let j=0;j<=rings;j++){
  const t=j/rings,r=.4+(rad-.4)*t,y=-4.65+4.65*t*t;
  for(let k=0;k<=segments;k++){const a=k/segments*Math.PI*2;verts.push(r*Math.cos(a),y,r*Math.sin(a))}
 }
 for(let j=0;j<rings;j++)for(let k=0;k<segments;k++){const a=j*(segments+1)+k,b=a+segments+1;indices.push(a,a+1,b,a+1,b+1,b)}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(indices);geo.computeVertexNormals();
 upperBowlMesh=new THREE.Group();upperBowlMesh.position.set(offsetX,y0,bowlPos.z);
 const glass=new THREE.Mesh(geo,funnelGlass);glass.material=funnelGlass.clone();glass.material.opacity=.36;glass.material.side=THREE.DoubleSide;upperBowlMesh.add(glass);
 const lip=new THREE.Mesh(new THREE.TorusGeometry(rad,.18,10,64),mat('#f2faff'));lip.rotation.x=Math.PI/2;upperBowlMesh.add(lip);scene.add(upperBowlMesh);
 upperBowlBody=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(offsetX,y0,bowlPos.z));
 world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts),new Uint32Array(indices)).setFriction(.45).setRestitution(.12),upperBowlBody);
}
function tipUpperBowl(){if(!upperBowlBody||phase!=='release'&&phase!=='race')return;
 upperTip=Math.min(1.82,upperTip+STEP*.48);
 const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-upperTip);
 upperBowlBody.setNextKinematicRotation({x:q.x,y:q.y,z:q.z,w:q.w});upperBowlMesh.quaternion.copy(q);
}
function createBowl(){
 funnelVisual=new THREE.Group();scene.add(funnelVisual);
 const rings=24,sides=72,verts=[],indices=[];
 for(let j=0;j<=rings;j++){
  const t=j/rings,r=OUTLET_R+(FUNNEL_R-OUTLET_R)*t;
  const y=FUNNEL_BOTTOM+(FUNNEL_TOP-FUNNEL_BOTTOM)*Math.pow(t,1.25);
  for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2;verts.push(bowlPos.x+r*Math.cos(a),y,bowlPos.z+r*Math.sin(a));}
 }
 for(let j=0;j<rings;j++)for(let i=0;i<sides;i++){
  const a=j*(sides+1)+i,b=a+sides+1;
  indices.push(a,b,a+1,b,b+1,a+1);
 }
 const positions=new Float32Array(verts),triangles=new Uint32Array(indices);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(new THREE.BufferAttribute(triangles,1));geometry.computeVertexNormals();
 const glass=new THREE.Mesh(geometry,funnelGlass);glass.renderOrder=3;funnelVisual.add(glass);
 world.createCollider(RAPIER.ColliderDesc.trimesh(positions,triangles).setFriction(.54).setRestitution(.32));
 const rim=new THREE.Mesh(new THREE.TorusGeometry(FUNNEL_R,.19,10,72),new THREE.MeshStandardMaterial({color:'#c4faff',metalness:.48,roughness:.14}));rim.rotation.x=Math.PI/2;rim.position.set(bowlPos.x,FUNNEL_TOP,bowlPos.z);funnelVisual.add(rim);
 // Rigid, segmented safety rim to prevent marbles leaving the top edge.
 for(let i=0;i<64;i++){
  const a=(i+.5)*Math.PI*2/64,arc=2*Math.PI*FUNNEL_R/64;
  const x=bowlPos.x+FUNNEL_R*Math.cos(a),z=bowlPos.z+FUNNEL_R*Math.sin(a);
  const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-a);
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,FUNNEL_TOP+1.1,z).setRotation(q));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.18,1.45,arc*.55).setFriction(.5),body);
 }
 // Vertical drain guide: its radius is wide enough for two marbles to pass.
 for(let i=0;i<32;i++){
  const a=(i+.5)*Math.PI*2/32,arc=2*Math.PI*OUTLET_R/32;
  const x=bowlPos.x+OUTLET_R*Math.cos(a),z=bowlPos.z+OUTLET_R*Math.sin(a);
  const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-a);
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,6.2,z).setRotation(q));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.12,1.55,arc*.55).setFriction(.35),body);
  const mesh=new THREE.Mesh(boxGeo,funnelGlass);mesh.position.set(x,6.2,z);mesh.scale.set(.24,3.1,arc*1.1);mesh.quaternion.copy(q);funnelVisual.add(mesh);
 }
 // Physical gate: remove the rigid body to start, never move any marble.
 gateBody=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(bowlPos.x,FUNNEL_BOTTOM-.18,bowlPos.z));
 world.createCollider(RAPIER.ColliderDesc.cylinder(.24,OUTLET_R+.1).setFriction(.75).setRestitution(.12),gateBody);
 const gateMesh=new THREE.Mesh(new THREE.CylinderGeometry(OUTLET_R+.1,OUTLET_R+.1,.48,48),lavender);
 gateMesh.position.set(bowlPos.x,FUNNEL_BOTTOM-.18,bowlPos.z);gateMesh.name='gate';funnelVisual.add(gateMesh);
 // A landing lane below the outlet is the existing track itself, with side rails.
 // Funnel drain is centered over the first few metres of that physical track.
 const stripe=visualBox([TRACK_WIDTH-.9,.07,3.2],[0,3.61,-4],yellow);
 stripe.material.transparent=true;stripe.material.opacity=.8;
}
function closeGate(){if(gateBody)return;gateBody=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(bowlPos.x,FUNNEL_BOTTOM-.18,bowlPos.z));world.createCollider(RAPIER.ColliderDesc.cylinder(.24,OUTLET_R+.1).setFriction(.75),gateBody);const m=funnelVisual.getObjectByName('gate');if(m)m.visible=true;}
function openGate(){if(!gateBody)return;world.removeRigidBody(gateBody);gateBody=null;const m=funnelVisual.getObjectByName('gate');if(m)m.visible=false;}
// V27: shared UV marble designs create visible surface reference points as the
// Rapier bodies rotate. Only fourteen 512x256 textures are generated, even with
// sixty racers; podium marbles reuse the exact same palette and rolling pattern.
function makeMarbleDesign(color,index){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
 const c=canvas.getContext('2d');const w=canvas.width,h=canvas.height;
 const base=new THREE.Color(color);
 const shade='#'+base.clone().multiplyScalar(.66).getHexString();
 const glaze=c.createLinearGradient(0,0,0,h);
 glaze.addColorStop(0,shade);glaze.addColorStop(.22,color);glaze.addColorStop(.68,color);glaze.addColorStop(1,shade);
 c.fillStyle=glaze;c.fillRect(0,0,w,h);
 // Off-center, gently curving ribbons repeat at the UV seam so the surface is continuous.
 c.lineCap='round';c.lineJoin='round';
 const styles=['#fff8e9','#fff5d8','#ecfaff'];
 for(let band=0;band<3;band++){
  const offset=(index*21+band*143)%w;
  for(const wrap of [-w,0,w]){
   c.beginPath();
   for(let t=0;t<=30;t++){
    const y=t*h/30;
    const x=wrap+offset+62*Math.sin((y/h)*Math.PI*2+band*1.65+index*.15);
    if(t===0)c.moveTo(x,y);else c.lineTo(x,y);
   }
   c.strokeStyle='rgba(30,30,68,.28)';c.lineWidth=28;c.stroke();
   c.strokeStyle=styles[(index+band)%styles.length];c.lineWidth=17;c.stroke();
  }
 }
 // Asymmetric polka-dot highlights make the direction of roll obvious from afar.
 for(let dot=0;dot<8;dot++){
  const x=(index*47+dot*113+54)%w,y=30+((dot*79+index*13)%192);
  c.beginPath();c.arc(x,y,dot%3===0?10:5.5,0,Math.PI*2);
  c.fillStyle=dot%2===0?'rgba(255,255,255,.95)':'rgba(24,37,81,.48)';c.fill();
 }
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 texture.wrapS=THREE.RepeatWrapping;texture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),4);
 return texture;
}
const marbleTextures=COLORS.map(makeMarbleDesign);
const marbleMaterials=marbleTextures.map(map=>new THREE.MeshPhysicalMaterial({map,color:'#ffffff',metalness:.08,roughness:.19,clearcoat:1,clearcoatRoughness:.07}));
// Bright, ring-free player marker: two soft radial halos plus a spherical Fresnel glow.
// The texture fades continuously in all directions; no torus / Saturn ring is used.
function createGlowTexture(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
 const ctx=canvas.getContext('2d');const gradient=ctx.createRadialGradient(64,64,5,64,64,64);
 gradient.addColorStop(0,'rgba(255,244,171,0.95)');
 gradient.addColorStop(.19,'rgba(255,215,63,0.85)');
 gradient.addColorStop(.44,'rgba(255,176,28,0.52)');
 gradient.addColorStop(.75,'rgba(255,177,32,0.17)');
 gradient.addColorStop(1,'rgba(255,177,32,0)');
 ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 return texture;
}
const playerGlowTexture=createGlowTexture();
function highlightPlayerMarble(mesh){
 const aura=new THREE.Mesh(new THREE.SphereGeometry(R*1.68,32,24),new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.BackSide,blending:THREE.AdditiveBlending,
  uniforms:{glowColor:{value:new THREE.Color('#ffd43b')}},
  vertexShader:'varying vec3 vNormal;varying vec3 vView;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
  fragmentShader:'uniform vec3 glowColor;varying vec3 vNormal;varying vec3 vView;void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),1.05);gl_FragColor=vec4(glowColor,0.52+rim*0.48);}'
 }));mesh.add(aura);
 const makeHalo=(size,opacity)=>{
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:playerGlowTexture,color:'#ffd33f',transparent:true,opacity,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending}));
  sprite.scale.set(size,size,1);mesh.add(sprite);return sprite;
 };
 const outer=makeHalo(6.3,.90),inner=makeHalo(3.4,.95);
 const light=new THREE.PointLight('#ffda5b',5.5,7.5);mesh.add(light);
 return {outer,inner,light};
}
// V19: an on-site podium in the SAME Three.js scene (no page reload).
// The display is decorative: finish order is still taken from local Rapier results.
const podiumOrigin=new THREE.Vector3(0,17,82);
let podiumGroup=null,podiumMarbles=[],podiumSlots=[],podiumPrize=null,podiumIsPrepared=false;
let podiumTransitionStart=0, podiumTransitionFrame=0, podiumVisible=false;
function podiumText(text,color='#ffffff',fontSize=54){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,512,128);
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${fontSize}px 'Lilita One', system-ui, sans-serif`;
 ctx.shadowColor='#2b174e';ctx.shadowBlur=9;ctx.fillStyle=color;ctx.fillText(String(text).slice(0,24),256,64,476);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false});
 const sprite=new THREE.Sprite(material);sprite.scale.set(6.4,1.6,1);return sprite;
}
function clearPodium(){
 if(!podiumGroup)return;
 podiumVisible=false;
 scene.remove(podiumGroup);
 podiumGroup.traverse(obj=>{if(obj.geometry)obj.geometry.dispose();if(obj.material){for(const m of (Array.isArray(obj.material)?obj.material:[obj.material])){if(m.map&&!marbleTextures.includes(m.map))m.map.dispose();m.dispose();}}});
 podiumGroup=null;podiumMarbles=[];podiumSlots=[];podiumPrize=null;podiumIsPrepared=false;
}
function preparePodium(){
 if(podiumIsPrepared)return;
 podiumGroup=new THREE.Group();podiumGroup.position.copy(podiumOrigin);podiumGroup.visible=false;scene.add(podiumGroup);
 podiumIsPrepared=true;
 const podiumColors=['#dcb44c','#b9c4d5','#bd8463'];
 const slots=[{x:-5.0,h:3.5,place:2},{x:0,h:5.1,place:1},{x:5.0,h:2.6,place:3}];
 const floor=new THREE.Mesh(new THREE.CylinderGeometry(11,11,.65,64),new THREE.MeshStandardMaterial({color:'#5e42bc',metalness:.25,roughness:.35}));floor.position.y=-.32;podiumGroup.add(floor);
 for(const slot of slots){
  const color=podiumColors[slot.place-1];
  const pedestal=new THREE.Mesh(new THREE.BoxGeometry(4.2,slot.h,4.1),new THREE.MeshStandardMaterial({color,metalness:.52,roughness:.28,emissive:slot.place===1?'#a37517':'#000000',emissiveIntensity:slot.place===1?.25:0}));
  pedestal.position.set(slot.x,slot.h/2,0);podiumGroup.add(pedestal);
  const trim=new THREE.Mesh(new THREE.BoxGeometry(4.36,.20,4.26),new THREE.MeshStandardMaterial({color:slot.place===1?'#f6d67b':slot.place===2?'#e5e9f1':'#e6ae8b',metalness:.45,roughness:.3,emissive:slot.place===1?'#8c6418':'#000000',emissiveIntensity:slot.place===1?.20:0}));trim.position.set(slot.x,slot.h+.04,0);podiumGroup.add(trim);
  const marble=new THREE.Mesh(new THREE.SphereGeometry(1.1,24,18),new THREE.MeshStandardMaterial({map:marbleTextures[slot.place-1],color:'#ffffff',metalness:.12,roughness:.17}));
  marble.position.set(slot.x,slot.h+1.40,0);podiumGroup.add(marble);podiumMarbles.push({mesh:marble,y:marble.position.y,place:slot.place});
  const name=podiumText('READY',slot.place===1?'#ffef9a':'#fff',48);name.position.set(slot.x,slot.h+3.55,0);podiumGroup.add(name);
  podiumSlots.push({place:slot.place,marble,name});
  if(slot.place===1){
   const aura=new THREE.Sprite(new THREE.SpriteMaterial({map:playerGlowTexture,color:'#ffd447',opacity:.90,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
   aura.scale.set(7.2,7.2,1);marble.add(aura);
   const light=new THREE.PointLight('#ffe277',3.2,11);marble.add(light);
   const podiumLight=new THREE.PointLight('#ffd378',1.3,8);podiumLight.position.set(0,slot.h+.7,1.4);podiumGroup.add(podiumLight);
   const prize=podiumText('FIRST PLACE','#ead393',53);podiumPrize=prize;
   prize.scale.set(9.5,2.3,1);prize.position.set(0,11.5,0);podiumGroup.add(prize);
  }
 }
 // Compile shaders and upload podium text textures ahead of the finish frame.
 // Any one-time GPU setup cost is paid during initial race preparation.
 podiumGroup.visible=true;
 renderer.compile(scene,camera);
 for(const slot of podiumSlots)renderer.initTexture(slot.name.material.map);
 if(podiumPrize)renderer.initTexture(podiumPrize.material.map);
 podiumGroup.visible=false;
}
function updatePodiumText(sprite,text,color='#ffffff',fontSize=48){
 const canvas=sprite.material.map.image;
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${fontSize}px 'Lilita One', system-ui, sans-serif`;
 ctx.shadowColor='#2b174e';ctx.shadowBlur=8;ctx.fillStyle=color;
 ctx.fillText(String(text).slice(0,24),canvas.width/2,canvas.height/2,canvas.width-36);
 sprite.material.map.needsUpdate=true;
}
function showPodium(){
 preparePodium();
 for(const slot of podiumSlots){
  const racer=finished[slot.place-1];
  slot.marble.visible=Boolean(racer);slot.name.visible=Boolean(racer);
  if(racer){slot.marble.material.color.set('#ffffff');
   slot.marble.material.map=marbleTextures[racer.colorIndex];
   updatePodiumText(slot.name,racer.name,slot.place===1?'#ffef9a':'#ffffff');}
 }
 if(podiumPrize)updatePodiumText(podiumPrize,'✦ '+(players.length*ENTRY).toFixed(1)+' MON ✦','#ead393',53);
 podiumGroup.visible=true;
 podiumVisible=true;
 podiumTransitionStart=performance.now();
 podiumTransitionFrame=0;
 // The shared V34 curtain masks the change in the integrated app. Preserve
 // the old local-only fade when race.html is run without the parent lobby.
 if(window.parent===window)document.body.classList.add('podium-transition');
 const summary=$('#podiumLabels');
 summary.innerHTML=[2,1,3].map(place=>{
  const racer=finished[place-1];
  return `<div class="podium-label ${place===1?'podium-first':''}"><span>${['🥇','🥈','🥉'][place-1]} ${place===1?'CHAMPION':place===2?'RUNNER UP':'THIRD PLACE'}</span><strong>${racer?escapeHTML(racer.name):'—'}</strong></div>`;
 }).join('');
 $('#winningAmount').textContent=(players.length*ENTRY).toFixed(1)+' MON';
 $('#finish').style.display='flex';
 document.body.classList.add('show-podium');
}

function createPlayer(name,colorIndex,bot=false,wallet=null,id=null,exactColor=null){if(phase!=='lobby'||players.length>=MAX)return false;const i=players.length,angle=i*2.399963,r=1.2+Math.sqrt((i+1)/MAX)*6.15;const pos=new THREE.Vector3(-3.6+Math.cos(angle)*r,23.0+.9+Math.floor(i/12)*1.3,bowlPos.z+Math.sin(angle)*r);const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x,pos.y,pos.z).setLinearDamping(.12).setAngularDamping(.2).setCcdEnabled(true));world.createCollider(RAPIER.ColliderDesc.ball(R).setDensity(1.1).setFriction(.75).setRestitution(.45),body);const mesh=new THREE.Mesh(sphereGeo,marbleMaterials[colorIndex]);scene.add(mesh);const p={name:name.slice(0,18),colorIndex,bot,wallet,id,exactColor,body,mesh,finished:false,rank:0,progress:0,finishTime:0,stuckFor:0,lastAdvance:0,lastProgress:0,jumped:false,recoveries:0,transferRescued:false,drainRescued:false};const isViewer=viewerId!=null ? id===viewerId : (!handoff?.participants?.length && i===0);
 if(isViewer){p.glow=highlightPlayerMarble(mesh);p.isViewer=true;}
 players.push(p);updateUI();return true}
function removePlayer(p){world.removeRigidBody(p.body);scene.remove(p.mesh);p.mesh.remove(...p.mesh.children)}
function addBots(n){for(let i=0;i<n&&players.length<MAX;i++){const id=players.length+1;createPlayer('Bot '+String(id).padStart(2,'0'),(id*7)%COLORS.length,true)}}
function reset(){podiumVisible=false;clearPodium();document.body.classList.remove('show-podium','podium-transition');for(const p of players)removePlayer(p);players=[];finished=[];phase='lobby';elapsed=0;releaseTime=0;document.body.classList.remove('racing');$('#finish').style.display='none';$('#pool').classList.remove('final');$('#timer').textContent='LOBBY';closeGate();addBots(12);updateUI()}
function notifyAudio(sound){if(window.parent!==window)window.parent.postMessage({type:'monadmarbles:audio',sound},location.origin)}
function toast(msg){const t=$('#toast');t.textContent=msg;t.style.display='block';clearTimeout(toast.timeout);t.timeout=setTimeout(()=>t.style.display='none',2200)}
function escapeHTML(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}function short(s){return s.slice(0,6)+'…'+s.slice(-4)}
function updateUI(){const n=players.length;$('#poolValue').textContent=(n*ENTRY).toFixed(1)+' MON';$('#count').textContent=n+' ENTRIES';$('#start').disabled=phase!=='lobby'||n<1;const sorted=players.slice().sort((a,b)=>a.finished&&b.finished?a.rank-b.rank:a.finished?-1:b.finished?1:b.progress-a.progress);$('#board').innerHTML=sorted.slice(0,5).map((p,i)=>`<div class="entry ${p.isViewer?'my-entry':''}"><b><span class="dot" style="background:${p.exactColor||COLORS[p.colorIndex]}"></span>${i+1}. ${escapeHTML(p.name)}</b><span>${p.finished?'🏁':phase==='lobby'?(p.wallet?short(p.wallet):'BOT'):Math.round(p.progress/LENGTH*100)+'%'}</span></div>`).join('')||'Add racers to begin.';$('#myMarble').textContent=players.find(p=>p.isViewer)?.name||'Spectating race';$('#phase').textContent=phase==='lobby'?'Waiting for racers':phase==='release'?'Funnel draining…':phase==='race'?'Racing!':'Race complete'}
$('#start').onclick=()=>{if(players.length<1)return;notifyAudio('start');preparePodium();phase='release';releaseTime=0;elapsed=0;finished=[];openGate();document.body.classList.add('racing');toast('UPPER BOWL TIPPING!');updateUI()};
function returnToLobby(){
 if(window.parent!==window){window.parent.postMessage({type:'monadmarbles:return-to-lobby'},location.origin)}
 else window.location.assign('/');
}
$('#reset').onclick=returnToLobby;$('#again').onclick=returnToLobby;
document.querySelector('.back')?.addEventListener('click',event=>{event.preventDefault();returnToLobby()});
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==window.parent)return;
 if(event.data?.type==='monadmarbles:race-start'&&phase==='lobby'){$('#start').click()}
 if(event.data?.type==='monadmarbles:podium-show'&&phase==='done'&&!podiumVisible){
  // Only reveal podium AFTER the persistent V34 curtain has fully covered us.
  showPodium();
  updateCamera(1/60);
  renderer.render(scene,camera);
  window.parent.postMessage({type:'monadmarbles:podium-ready'},location.origin);
 }
});
// Failsafes are limited to the transfer stages: 48 entrants must reach the track.
// They only activate after a generous physics-first window, so normal drops remain natural.
function rescueTransfers(){
 if(phase!=='release'&&phase!=='race')return;
 for(let i=0;i<players.length;i++){
  const p=players[i];if(p.finished||p.progress>7)continue;
  const v=p.body.translation();
  if(releaseTime>11&&!p.transferRescued&&(v.y>17.5||v.x<-12||v.x>11||Math.hypot(v.x-bowlPos.x,v.z-bowlPos.z)>FUNNEL_R+2.5)){
   const a=i*2.399963,r=3.4+(i%4)*.48;
   p.body.setTranslation({x:bowlPos.x+Math.cos(a)*r,y:FUNNEL_TOP+2.8+(i%3)*.9,z:bowlPos.z+Math.sin(a)*r},true);
   p.body.setLinvel({x:-Math.sin(a)*2.5,y:-3,z:Math.cos(a)*2.5},true);
   p.transferRescued=true;
  }
  // A marble lingering in the funnel or lost under the scenery is put safely
  // into the starting lane rather than excluded from the race.
  if(releaseTime>21&&!p.drainRescued&&p.progress<7){
   const start=trackPoint(9+(i%5)*1.5,(i%5-2)*1.5,2.8);
   const t=trackTangent(10);
   p.body.setTranslation({x:start.x,y:start.y,z:start.z},true);
   p.body.setLinvel({x:t.x*7,y:0,z:t.z*7},true);
   p.drainRescued=true;p.stuckFor=0;p.progress=Math.max(p.progress,8);
  }
 }
}
function updateBowl(){
 if(phase!=='release')return;
 releaseTime+=STEP;
 // Keep the funnel visible; switch to race camera after the majority have exited.
 const below=players.filter(p=>p.body.translation().y<6.0).length;
 if((below>=players.length*.75&&releaseTime>2)||releaseTime>24){phase='race';updateUI();}
}
function releaseUpperBowlMarbles(){
 if(phase!=='release' || upperTip<.25)return;
 for(const p of players){
  const v=p.body.translation();
  // Only affect marbles still in the upper-bowl region; once falling into
  // the funnel they are governed by gravity and marble-to-marble collisions.
  if(v.y<18.2 || v.y>29 || v.x>6.5 || v.x<-13.5)continue;
  const speed=p.body.linvel();
  // Bowl is left of the funnel: push toward the funnel center (+X).
  // Keep this as a small continuous impulse, not a position change.
  const drive=Math.max(0,Math.min(1,(upperTip-.25)/.8));
  p.body.applyImpulse({x:(.17+Math.max(0,2.5-speed.x)*.035)*drive,y:0,z:(bowlPos.z-v.z)*.007*drive},true);
 }
}
function mixFunnel(){
 // Tangential force continuously shuffles the pack. Individual collision responses
 // determine order, and no positions are assigned when the gate opens.
 if(phase!=='lobby'&&phase!=='release')return;
 for(const p of players){
  const v=p.body.translation();if(v.y<7.1||v.y>22)continue;
  const dx=v.x-bowlPos.x,dz=v.z-bowlPos.z,r=Math.hypot(dx,dz);
  if(r<.1||r>FUNNEL_R+1.5)continue;
  // Mild inward steering in the lower funnel reduces endless circular orbits.
  const nearDrain=phase==='release' && v.y<FUNNEL_BOTTOM+3.8;
  const spin=(phase==='lobby'?.16:nearDrain?.020:.10),radial=(phase==='lobby'?.03:nearDrain?.36:.07);
  const jx=(-dz/r*spin-dx/r*radial),jz=(dx/r*spin-dz/r*radial);
  p.body.applyImpulse({x:jx,y:nearDrain?-.20:0,z:jz},true);
  // A short one-way exit assist gives crowded marbles a launch onto the track.
  // It is applied only inside the drain and only before reaching the race lane.
  if(phase==='release' && v.y>FUNNEL_BOTTOM-1.3 && v.y<FUNNEL_BOTTOM+1.35 && r<OUTLET_R+.55 && p.progress<7){
   const speed=p.body.linvel();
   p.body.applyImpulse({x:Math.max(0,.15-speed.x*.010),y:-.26,z:Math.min(0,-.23-speed.z*.010)},true);
  }
 }
}
function updateObstacles(){for(const o of obstacles){o.angle+=STEP*SPINNER_SPEED;const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),o.angle);o.pivot.setNextKinematicRotation(q);o.mesh.quaternion.copy(q)}}
const tempVec=new THREE.Vector3();function updatePhysics(){elapsed+=STEP;updateBowl();tipUpperBowl();releaseUpperBowlMarbles();mixFunnel();rescueTransfers();updateObstacles();world.step();for(const p of players){const tr=p.body.translation(),rot=p.body.rotation();p.mesh.position.set(tr.x,tr.y,tr.z);p.mesh.quaternion.set(rot.x,rot.y,rot.z,rot.w);if(p.glow){const pulse=1+.09*Math.sin(elapsed*3.2);p.glow.outer.scale.setScalar(6.3*pulse);p.glow.inner.scale.setScalar(3.4*(1+.07*Math.sin(elapsed*3.2)));p.glow.light.intensity=5.5+.8*Math.sin(elapsed*3.2);}if(phase==='lobby'||p.finished)continue;
// Gravity, real rigid-body contacts and a gentle downhill conveyor force coexist.
// This is not a scripted position or lane assignment.
const s=Math.max(0,Math.min(LENGTH,-tr.z));if(tr.y<6.5)p.progress=Math.max(p.progress,s);const vel=p.body.linvel();const tangent=trackTangent(s);
// Jump launches only when crossing the ramp; cooldown prevents repeated midair launches.
if(s>JUMP_AT-2&&s<JUMP_AT+3&&tr.y<5.5&&tr.y>-9&&!p.jumped){
 const forward=Math.max(0,vel.x*tangent.x+vel.z*tangent.z);
 p.body.applyImpulse({x:tangent.x*Math.max(0,3-forward*.12),y:5.8,z:tangent.z*Math.max(0,3-forward*.12)},true);p.jumped=true;}
if(s>JUMP_AT+17)p.jumped=false;
// Sweeper underpass rescue: only intervene after a marble stays below a spinning arm
// without meaningful forward motion. Keep a per-marble timer to avoid sudden teleports.
const nearSweeper=obstacles.some(o=>Math.abs(s-o.s)<3.7);
const underSweeper=nearSweeper&&tr.y<trackCenter(s).y+1.05&&tr.y>trackCenter(s).y-1.8;
const forwardUnder=vel.x*tangent.x+vel.z*tangent.z;
if(underSweeper&&forwardUnder<1.8){p.sweeperJam=(p.sweeperJam||0)+STEP;}else p.sweeperJam=0;
if(p.sweeperJam>1.0){
 const target=trackPoint(Math.min(LENGTH-8,s+5.5),((players.indexOf(p)%3)-1)*1.9,2.4);
 p.body.setTranslation({x:target.x,y:target.y,z:target.z},true);
 p.body.setLinvel({x:tangent.x*9,y:1.2,z:tangent.z*9},true);
 p.sweeperJam=0;p.stuckFor=0;
}
// Anti-stall: sustained lack of progress triggers a gentle physical nudge, then
// a safe checkpoint rescue. No racer can remain permanently pinned behind a sweeper.
if(tr.y<7&&s>3){if(p.progress>p.lastProgress+1.4){p.lastProgress=p.progress;p.stuckFor=0;}else p.stuckFor+=STEP;
 if(p.stuckFor>3){const side=trackSide(s),sign=(p.recoveries%2?1:-1);p.body.applyImpulse({x:tangent.x*5+side.x*sign*1.5,y:2.5,z:tangent.z*5+side.z*sign*1.5},true);p.stuckFor=1.5;p.recoveries++;}
 if(p.recoveries>5&&p.stuckFor>1.8){const safe=trackPoint(Math.min(LENGTH-8,s+8),((p.recoveries%3)-1)*2.0,2.3);p.body.setTranslation({x:safe.x,y:safe.y,z:safe.z},true);p.body.setLinvel({x:tangent.x*9,y:0,z:tangent.z*9},true);p.stuckFor=0;p.recoveries=0;}
}
// Out-of-bounds recovery preserves progress and returns a fallen marble to a clear lane.
if(tr.y<trackCenter(s).y-12||Math.abs(tr.x-trackCenter(s).x)>TRACK_WIDTH/2+7){const safe=trackPoint(Math.min(LENGTH-8,Math.max(8,p.progress)),(players.indexOf(p)%3-1)*2.2,3);p.body.setTranslation({x:safe.x,y:safe.y,z:safe.z},true);p.body.setLinvel({x:tangent.x*8,y:0,z:tangent.z*8},true);p.stuckFor=0;}if(tr.y<5.5&&tr.y>-9&&tr.z<1&&tr.z>-(LENGTH+10)){const forward=Math.max(0,vel.x*tangent.x+vel.z*tangent.z);const boost=Math.max(0,13-forward)*.11;p.body.applyImpulse({x:tangent.x*boost,y:0,z:tangent.z*boost},true)}
// Safety checkpoints keep racers in play; the track still uses Rapier contacts.
if(tr.y<8&&tr.z<=-(LENGTH-5)&&!p.finished){p.finished=true;p.rank=finished.length+1;p.finishTime=elapsed;finished.push(p);if(p.rank===1)toast('🏆 '+p.name+' wins!')}
}
// Event safeguard: after the time limit, award every remaining marble a finish
// in progress order so 48-player sessions cannot hang indefinitely.
if((phase==='race'||phase==='release')&&elapsed>MAX_RACE_SECONDS){for(const p of players.filter(p=>!p.finished).sort((a,b)=>b.progress-a.progress)){p.finished=true;p.rank=finished.length+1;p.finishTime=elapsed;finished.push(p);}toast('Race time limit reached — all remaining racers classified.');}
if((phase==='race'||phase==='release')&&finished.length===players.length&&players.length){
 phase='done';document.body.classList.remove('racing');updateUI();
 if(window.parent!==window)window.parent.postMessage({type:'monadmarbles:race-finished'},location.origin);
 else showPodium();
}}
let cameraLook=new THREE.Vector3(0,11,-4),cameraPos=new THREE.Vector3(19,23,23);
function updateCamera(delta){
 // Hold the last finish-line shot until the curtain fully covers the race.
 if(phase==='done'&&!podiumVisible){camera.position.copy(cameraPos);camera.lookAt(cameraLook);return;}
 const mode=$('#cameraMode')?.value||'leaders';let target,desired;
 if(phase==='done'){
  target=podiumOrigin.clone().add(new THREE.Vector3(0,5.1,0));
  desired=podiumOrigin.clone().add(new THREE.Vector3(0,8,27));
 }else
 if(phase==='lobby'||phase==='release'){
   target=new THREE.Vector3(0,11,-4);desired=new THREE.Vector3(19,23,23);
 }else if(mode==='mine'&&players.some(p=>p.isViewer&&!p.finished)){
   const p=players.find(p=>p.isViewer&&!p.finished),t=p.body.translation();
   target=new THREE.Vector3(t.x,t.y,t.z);desired=target.clone().add(new THREE.Vector3(10,12,16));
 }else{
   const leaders=players.filter(p=>!p.finished).sort((a,b)=>b.progress-a.progress).slice(0,mode==='wide'?12:5);
   const s=leaders.length?leaders.reduce((sum,p)=>sum+p.progress,0)/leaders.length:LENGTH-5;
   target=trackPoint(s,0,1.2);desired=target.clone().add(mode==='wide'?new THREE.Vector3(27,29,37):new THREE.Vector3(15,17,23));
 }
 // The podium stage is far from the track; do not spend seconds flying through
 // empty terrain. During a brief CSS fade, begin from a nearby establishing shot.
 if(phase==='done' && podiumTransitionFrame===0){
   cameraPos.copy(podiumOrigin).add(new THREE.Vector3(0,12,44));
   cameraLook.copy(podiumOrigin).add(new THREE.Vector3(0,4.6,0));
   podiumTransitionFrame=1;
 }
 const alpha=1-Math.exp(-delta*(phase==='done'?3.0:2.1));cameraPos.lerp(desired,alpha);cameraLook.lerp(target,alpha);camera.position.copy(cameraPos);camera.lookAt(cameraLook);
}
function render(now){requestAnimationFrame(render);const delta=Math.min(.05,(now-last)/1000);last=now;
 // Freeze Rapier after the final ranking; it must not keep stepping the entire
 // 60-player world under the podium animation.
 let steps=0;
 if(phase!=='done'){acc+=delta;while(acc>=STEP&&steps<3){updatePhysics();acc-=STEP;steps++;if(phase==='done')break}if(steps===3)acc=Math.min(acc,STEP)}else acc=0;
 if(phase==='done'&&now-podiumTransitionStart>900)document.body.classList.remove('podium-transition');
 updateCamera(delta);
 if(phase==='done')for(const {mesh,y,place} of podiumMarbles){mesh.rotation.y+=delta*(place===1?.85:.45);mesh.position.y=y+.15*Math.sin(now*.002+place);}
 renderer.render(scene,camera);frameCount++;fpsTime+=delta;if(fpsTime>1){frameCount=0;fpsTime=0}if(phase!=='lobby'&&Math.floor(elapsed*4)!==Math.floor((elapsed-steps*STEP)*4)){updateUI();$('#timer').textContent=elapsed.toFixed(1)+'s';const best=Math.max(0,...players.map(p=>p.progress));$('#pool').classList.toggle('final',best>LENGTH*.75)}}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
// Wallet connection belongs to the home lobby, not the race module.
// The previous v12 code tried to bind handlers to removed #wallet and #tx
// elements here. That null dereference prevented init() from ever running.
async function init(){try{await RAPIER.init();world=new RAPIER.World({x:0,y:-22,z:0});world.timestep=STEP;createTrack();createBowl();createUpperBowl();
 if(handoff?.participants?.length){for(const racer of handoff.participants.slice(0,MAX))createPlayer(String(racer.username||'Racer'),Number(racer.marbleDesign||0)%COLORS.length,!!racer.isBot,racer.walletAddress||null,racer.id,racer.color||null)}
 else{addBots(12);toast('No lobby entries found; adding racers.');}
 preparePodium();updateUI();
 // Draw a synchronous first frame before signaling readiness. This works even
 // when browsers throttle requestAnimationFrame on a covered/offscreen iframe.
 renderer.render(scene,camera);
 if(window.parent!==window){window.parent.postMessage({type:'monadmarbles:race-ready'},location.origin)}
 else setTimeout(()=>$('#start').click(),500);
 requestAnimationFrame(render);
 }catch(e){console.error(e);console.warn('Physics failed to load:',e.message);
 if(window.parent!==window)window.parent.postMessage({type:'monadmarbles:race-error',message:e.message},location.origin);
 }}init();

// Authoritative Rapier simulation of the V27 300-unit candy course.
// Isolated to RACE_COURSE=v27. The paid production race continues to use physics.js.
// Geometry and rescue impulses are ported from v27-integrated/src/main.js.
const RAPIER = require("@dimforge/rapier3d-compat");
const { Vector3, Quaternion } = require("three");

const STEP = 1 / 60;
const LENGTH = 300;
const WIDTH = 13.5;
const RADIUS = 0.57;
const MAX_SECONDS = 105;
const JUMP_AT = 185;
const SPINNER_SPEED = 1.8;
const BOWL = new Vector3(0, 0, -4);
const FUNNEL_R = 12.7;
const OUTLET_R = 2.95;
const FUNNEL_BOTTOM = 7.7;
const FUNNEL_TOP = 16.3;
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, -1);
let initialization;

function trackCenter(s) {
  return new Vector3(4 * Math.sin(s * .028) + 3 * Math.sin(s * .075), 3.5 - .027 * s, -s);
}
function trackTangent(s) {
  return trackCenter(Math.min(LENGTH, s + .25))
    .sub(trackCenter(Math.max(0, s - .25))).normalize();
}
function trackSide(s) {
  const t = trackTangent(s);
  return new Vector3(-t.z, 0, t.x).normalize();
}
function trackPoint(s, lateral = 0, height = 0) {
  return trackCenter(s).addScaledVector(trackSide(s), lateral).add(new Vector3(0, height, 0));
}
function v3(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}
function q4(rotation) {
  return { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
}
function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

class V27RaceEngine {
  static async create(entries) {
    if (!initialization) initialization = RAPIER.init();
    await initialization;
    return new V27RaceEngine(entries);
  }

  constructor(entries) {
    this.world = new RAPIER.World({ x: 0, y: -22, z: 0 });
    this.world.timestep = STEP;
    this.ticks = 0;
    this.elapsed = 0;
    this.phase = "release";
    this.releaseTime = 0;
    this.upperTip = 0;
    this.finished = false;
    this.winnerId = null;
    this.finishOrder = [];
    this.obstacles = [];
    this.players = [];
    this.marbleBodies = new Map();
    this.upperBowlBody = null;
    this.gateBody = null;
    this.createTrack();
    this.createBowl();
    this.createUpperBowl();
    entries.forEach((entry, i) => this.createMarble(entry, i));
    this.openGate();
  }

  rigidBox(size, position, rotation = null) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(q4(rotation || new Quaternion())),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
        .setFriction(.75).setRestitution(.18),
      body,
    );
    return body;
  }

  createTrack() {
    const segments = 90;
    for (let i = 0; i < segments; i++) {
      const s0 = i * LENGTH / segments, s1 = (i + 1) * LENGTH / segments;
      const a = trackCenter(s0), b = trackCenter(s1);
      const mid = a.clone().add(b).multiplyScalar(.5);
      const rot = new Quaternion().setFromUnitVectors(FORWARD, b.clone().sub(a).normalize());
      const len = a.distanceTo(b) + .35;
      this.rigidBox([WIDTH, .65, len], new Vector3(mid.x, mid.y - .35, mid.z), rot);
      for (const sign of [-1, 1]) {
        const side = trackSide((s0 + s1) / 2);
        const p = mid.clone().addScaledVector(side, sign * (WIDTH / 2 + .25));
        this.rigidBox([.65, 9, len], new Vector3(p.x, p.y + 4.1, p.z), rot);
      }
    }

    for (const s of [48, 117, 194, 263]) {
      const p = trackPoint(s, 0, .2);
      const q = new Quaternion().setFromUnitVectors(FORWARD, trackTangent(s));
      q.multiply(new Quaternion().setFromAxisAngle(AXIS_X, .095));
      this.rigidBox([WIDTH - 1, .25, 7], p, q);
    }

    for (const s of [25, 87, 153, 227, 281]) {
      const p = trackPoint(s, 0, 1.02);
      const angle = s * .13;
      const initial = new Quaternion().setFromAxisAngle(AXIS_Y, angle);
      const pivot = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(p.x, p.y, p.z).setRotation(q4(initial)),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid((6.6 - .70) / 2, .70 / 2, .90 / 2)
          .setFriction(.18).setRestitution(.52), pivot,
      );
      for (const sign of [-1, 1]) {
        this.world.createCollider(
          RAPIER.ColliderDesc.ball(.35).setTranslation(sign * (6.6 - .70) / 2, 0, 0)
            .setFriction(.18).setRestitution(.52), pivot,
        );
      }
      this.obstacles.push({ s, pivot, angle });
    }

    for (const s of [63, 135, 207, 275]) {
      for (const lane of [-3.6, 3.6]) {
        const p = trackPoint(s, lane, 1.05);
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z));
        this.world.createCollider(RAPIER.ColliderDesc.ball(1.05).setRestitution(.9), body);
      }
    }

    {
      const s = JUMP_AT, p = trackPoint(s, 0, .43);
      const q = new Quaternion().setFromUnitVectors(FORWARD, trackTangent(s));
      q.multiply(new Quaternion().setFromAxisAngle(AXIS_X, .065));
      this.rigidBox([WIDTH - 1.5, .30, 9], new Vector3(p.x, p.y - .10, p.z), q);
      for (let k = 0; k < 11; k++) {
        const at = s - 8 + k * 4;
        const center = trackPoint(at, 0, -.10);
        const rot = new Quaternion().setFromUnitVectors(FORWARD, trackTangent(at));
        this.rigidBox([WIDTH + 3, .55, 4.8], center, rot);
        for (const side of [-1, 1]) {
          const wall = trackPoint(at, side * (WIDTH / 2 + 1.65), 3.65);
          this.rigidBox([.7, 9, 4.8], wall, rot);
        }
      }
    }

    for (const [s, lane] of [[39, -2.2], [51, 2.2], [102, 1.9], [114, -2.2],
      [169, -2.0], [181, 2.0], [239, 2.2], [251, -1.9]]) {
      const p = trackPoint(s, lane, .95);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z));
      this.world.createCollider(RAPIER.ColliderDesc.cylinder(.95, .63).setFriction(.6).setRestitution(.5), body);
    }
  }

  createBowl() {
    const rings = 24, sides = 72, verts = [], indices = [];
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const r = OUTLET_R + (FUNNEL_R - OUTLET_R) * t;
      const y = FUNNEL_BOTTOM + (FUNNEL_TOP - FUNNEL_BOTTOM) * Math.pow(t, 1.25);
      for (let i = 0; i <= sides; i++) {
        const a = i / sides * Math.PI * 2;
        verts.push(BOWL.x + r * Math.cos(a), y, BOWL.z + r * Math.sin(a));
      }
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) {
      const a = j * (sides + 1) + i, b = a + sides + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(indices))
        .setFriction(.54).setRestitution(.32),
    );
    for (let i = 0; i < 64; i++) {
      const a = (i + .5) * Math.PI * 2 / 64, arc = 2 * Math.PI * FUNNEL_R / 64;
      const x = BOWL.x + FUNNEL_R * Math.cos(a), z = BOWL.z + FUNNEL_R * Math.sin(a);
      const q = new Quaternion().setFromAxisAngle(AXIS_Y, -a);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, FUNNEL_TOP + 1.1, z).setRotation(q4(q)),
      );
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(.18, 1.45, arc * .55).setFriction(.5), body);
    }
    for (let i = 0; i < 32; i++) {
      const a = (i + .5) * Math.PI * 2 / 32, arc = 2 * Math.PI * OUTLET_R / 32;
      const x = BOWL.x + OUTLET_R * Math.cos(a), z = BOWL.z + OUTLET_R * Math.sin(a);
      const q = new Quaternion().setFromAxisAngle(AXIS_Y, -a);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, 6.2, z).setRotation(q4(q)),
      );
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(.12, 1.55, arc * .55).setFriction(.35), body);
    }
    this.gateBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(BOWL.x, FUNNEL_BOTTOM - .18, BOWL.z),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(.24, OUTLET_R + .1).setFriction(.75).setRestitution(.12),
      this.gateBody,
    );
  }

  createUpperBowl() {
    const y0 = 23, offsetX = -3.6, segments = 64, rings = 14, rad = 8.4;
    const verts = [], indices = [];
    for (let j = 0; j <= rings; j++) {
      const t = j / rings, r = .4 + (rad - .4) * t, y = -4.65 + 4.65 * t * t;
      for (let k = 0; k <= segments; k++) {
        const a = k / segments * Math.PI * 2;
        verts.push(r * Math.cos(a), y, r * Math.sin(a));
      }
    }
    for (let j = 0; j < rings; j++) for (let k = 0; k < segments; k++) {
      const a = j * (segments + 1) + k, b = a + segments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    this.upperBowlBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(offsetX, y0, BOWL.z),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(indices))
        .setFriction(.45).setRestitution(.12), this.upperBowlBody,
    );
  }

  createMarble(entry, i) {
    const a = i * 2.399963, r = 1.2 + Math.sqrt((i + 1) / 60) * 6.15;
    const pos = new Vector3(-3.6 + Math.cos(a) * r, 23.9 + Math.floor(i / 12) * 1.3,
      BOWL.z + Math.sin(a) * r);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
        .setLinearDamping(.12).setAngularDamping(.2).setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(RADIUS).setDensity(1.1).setFriction(.75).setRestitution(.45), body,
    );
    this.marbleBodies.set(entry.id, body);
    this.players.push({ id: entry.id, body, progress: 0, finished: false,
      jumped: false, stuckFor: 0, lastProgress: 0, recoveries: 0,
      sweeperJam: 0, transferRescued: false, drainRescued: false });
  }

  openGate() {
    if (this.gateBody) this.world.removeRigidBody(this.gateBody);
    this.gateBody = null;
  }

  step() {
    if (this.done) return;
    this.elapsed += STEP;
    this.ticks++;
    this.updateBowl();
    this.tipUpperBowl();
    this.releaseUpperBowlMarbles();
    this.mixFunnel();
    this.rescueTransfers();
    this.updateObstacles();
    this.world.step();

    const newlyFinished = [];
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.finished) continue;
      const tr = p.body.translation();
      const s = clamp(-tr.z, 0, LENGTH);
      if (tr.y < 6.5) p.progress = Math.max(p.progress, s);
      const vel = p.body.linvel(), tangent = trackTangent(s);
      if (s > JUMP_AT - 2 && s < JUMP_AT + 3 && tr.y < 5.5 && tr.y > -9 && !p.jumped) {
        const forward = Math.max(0, vel.x * tangent.x + vel.z * tangent.z);
        p.body.applyImpulse({ x: tangent.x * Math.max(0, 3 - forward * .12),
          y: 5.8, z: tangent.z * Math.max(0, 3 - forward * .12) }, true);
        p.jumped = true;
      }
      if (s > JUMP_AT + 17) p.jumped = false;
      const nearSweeper = this.obstacles.some(o => Math.abs(s - o.s) < 3.7);
      const underSweeper = nearSweeper && tr.y < trackCenter(s).y + 1.05 &&
        tr.y > trackCenter(s).y - 1.8;
      const forwardUnder = vel.x * tangent.x + vel.z * tangent.z;
      if (underSweeper && forwardUnder < 1.8) p.sweeperJam += STEP;
      else p.sweeperJam = 0;
      if (p.sweeperJam > 1) {
        const target = trackPoint(Math.min(LENGTH - 8, s + 5.5), ((i % 3) - 1) * 1.9, 2.4);
        p.body.setTranslation(v3(target), true);
        p.body.setLinvel({ x: tangent.x * 9, y: 1.2, z: tangent.z * 9 }, true);
        p.sweeperJam = 0; p.stuckFor = 0;
      }
      if (tr.y < 7 && s > 3) {
        if (p.progress > p.lastProgress + 1.4) {
          p.lastProgress = p.progress; p.stuckFor = 0;
        } else p.stuckFor += STEP;
        if (p.stuckFor > 3) {
          const side = trackSide(s), sign = p.recoveries % 2 ? 1 : -1;
          p.body.applyImpulse({ x: tangent.x * 5 + side.x * sign * 1.5,
            y: 2.5, z: tangent.z * 5 + side.z * sign * 1.5 }, true);
          p.stuckFor = 1.5; p.recoveries++;
        }
        if (p.recoveries > 5 && p.stuckFor > 1.8) {
          const target = trackPoint(Math.min(LENGTH - 8, s + 8), ((p.recoveries % 3) - 1) * 2, 2.3);
          p.body.setTranslation(v3(target), true);
          p.body.setLinvel({ x: tangent.x * 9, y: 0, z: tangent.z * 9 }, true);
          p.stuckFor = 0; p.recoveries = 0;
        }
      }
      if (tr.y < trackCenter(s).y - 12 || Math.abs(tr.x - trackCenter(s).x) > WIDTH / 2 + 7) {
        const target = trackPoint(Math.min(LENGTH - 8, Math.max(8, p.progress)),
          (i % 3 - 1) * 2.2, 3);
        p.body.setTranslation(v3(target), true);
        p.body.setLinvel({ x: tangent.x * 8, y: 0, z: tangent.z * 8 }, true);
        p.stuckFor = 0;
      }
      if (tr.y < 5.5 && tr.y > -9 && tr.z < 1 && tr.z > -(LENGTH + 10)) {
        const forward = Math.max(0, vel.x * tangent.x + vel.z * tangent.z);
        const boost = Math.max(0, 13 - forward) * .11;
        p.body.applyImpulse({ x: tangent.x * boost, y: 0, z: tangent.z * boost }, true);
      }
      if (tr.y < 8 && tr.z <= -(LENGTH - 5)) newlyFinished.push(p);
    }
    // Same-tick order uses deterministic paid entry identity, never client order.
    for (const p of newlyFinished.sort((a, b) => a.id.localeCompare(b.id))) {
      p.finished = true;
      this.finishOrder.push(p.id);
      if (!this.winnerId) this.winnerId = p.id;
    }
    if (this.elapsed >= MAX_SECONDS) {
      for (const p of this.players.filter(p => !p.finished)
        .sort((a, b) => b.progress - a.progress || a.id.localeCompare(b.id))) {
        p.finished = true;
        this.finishOrder.push(p.id);
        if (!this.winnerId) this.winnerId = p.id;
      }
    }
    if (this.finishOrder.length >= Math.min(3, this.players.length)) this.finished = true;
  }

  tipUpperBowl() {
    this.upperTip = Math.min(1.82, this.upperTip + STEP * .48);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -this.upperTip);
    this.upperBowlBody.setNextKinematicRotation(q4(q));
  }

  updateBowl() {
    if (this.phase !== "release") return;
    this.releaseTime += STEP;
    const below = this.players.filter(p => p.body.translation().y < 6).length;
    if ((below >= this.players.length * .75 && this.releaseTime > 2) ||
        this.releaseTime > 24) this.phase = "race";
  }

  releaseUpperBowlMarbles() {
    if (this.phase !== "release" || this.upperTip < .25) return;
    for (const p of this.players) {
      const v = p.body.translation();
      if (v.y < 18.2 || v.y > 29 || v.x > 6.5 || v.x < -13.5) continue;
      const speed = p.body.linvel();
      const drive = clamp((this.upperTip - .25) / .8, 0, 1);
      p.body.applyImpulse({ x: (.17 + Math.max(0, 2.5 - speed.x) * .035) * drive,
        y: 0, z: (BOWL.z - v.z) * .007 * drive }, true);
    }
  }

  mixFunnel() {
    if (this.phase !== "release") return;
    for (const p of this.players) {
      const v = p.body.translation();
      if (v.y < 7.1 || v.y > 22) continue;
      const dx = v.x - BOWL.x, dz = v.z - BOWL.z, r = Math.hypot(dx, dz);
      if (r < .1 || r > FUNNEL_R + 1.5) continue;
      const nearDrain = v.y < FUNNEL_BOTTOM + 3.8;
      const spin = nearDrain ? .020 : .10;
      const radial = nearDrain ? .36 : .07;
      p.body.applyImpulse({ x: -dz / r * spin - dx / r * radial,
        y: nearDrain ? -.20 : 0, z: dx / r * spin - dz / r * radial }, true);
      if (v.y > FUNNEL_BOTTOM - 1.3 && v.y < FUNNEL_BOTTOM + 1.35 &&
          r < OUTLET_R + .55 && p.progress < 7) {
        const speed = p.body.linvel();
        p.body.applyImpulse({ x: Math.max(0, .15 - speed.x * .010),
          y: -.26, z: Math.min(0, -.23 - speed.z * .010) }, true);
      }
    }
  }

  rescueTransfers() {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.finished || p.progress > 7) continue;
      const v = p.body.translation();
      if (this.releaseTime > 11 && !p.transferRescued &&
        (v.y > 17.5 || v.x < -12 || v.x > 11 ||
          Math.hypot(v.x - BOWL.x, v.z - BOWL.z) > FUNNEL_R + 2.5)) {
        const a = i * 2.399963, r = 3.4 + (i % 4) * .48;
        p.body.setTranslation({ x: BOWL.x + Math.cos(a) * r,
          y: FUNNEL_TOP + 2.8 + (i % 3) * .9, z: BOWL.z + Math.sin(a) * r }, true);
        p.body.setLinvel({ x: -Math.sin(a) * 2.5, y: -3, z: Math.cos(a) * 2.5 }, true);
        p.transferRescued = true;
      }
      if (this.releaseTime > 21 && !p.drainRescued && p.progress < 7) {
        const start = trackPoint(9 + (i % 5) * 1.5, (i % 5 - 2) * 1.5, 2.8);
        const tangent = trackTangent(10);
        p.body.setTranslation(v3(start), true);
        p.body.setLinvel({ x: tangent.x * 7, y: 0, z: tangent.z * 7 }, true);
        p.drainRescued = true; p.stuckFor = 0; p.progress = Math.max(p.progress, 8);
      }
    }
  }

  updateObstacles() {
    for (const obstacle of this.obstacles) {
      obstacle.angle += STEP * SPINNER_SPEED;
      const q = new Quaternion().setFromAxisAngle(AXIS_Y, obstacle.angle);
      obstacle.pivot.setNextKinematicRotation(q4(q));
    }
  }

  get done() {
    return this.finished || this.ticks >= MAX_SECONDS * 60;
  }

  snapshot(roundId) {
    return {
      roundId,
      tick: this.ticks,
      elapsed: this.elapsed,
      course: "v27",
      stage: this.phase,
      upperTip: this.upperTip,
      obstacleAngles: this.obstacles.map(o => o.angle),
      winnerId: this.winnerId,
      marbles: this.players.map(p => {
        const pos = p.body.translation();
        const rot = p.body.rotation();
        return {
          id: p.id, x: pos.x, y: pos.y, z: pos.z,
          qx: rot.x, qy: rot.y, qz: rot.z, qw: rot.w,
          progress: clamp(p.progress / LENGTH, 0, 1),
        };
      }),
    };
  }

  dispose() {
    this.world.free();
  }
}
module.exports = { V27RaceEngine, LENGTH, MAX_SECONDS };

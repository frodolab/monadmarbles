// One authoritative Rapier world on the race server. Renderers never determine a winner.
const RAPIER = require("@dimforge/rapier3d-compat");

const TILT = -0.22;
const ROTATION = { x: Math.sin(TILT / 2), y: 0, z: 0, w: Math.cos(TILT / 2) };
const BUMPERS = [
  [-1.7, 2.2], [0.1, 1.0], [1.8, -0.3], [-1.0, -2.1], [1.0, -3.7],
];
const FPS = 60;
const MAX_SECONDS = 60;

let initialized = null;

async function initRapier() {
  if (!initialized) initialized = RAPIER.init();
  await initialized;
}

function localCoordinates(point) {
  // Inverse of the track's rotation around X, used for progress and finish checks.
  return {
    x: point.x,
    y: Math.cos(TILT) * point.y + Math.sin(TILT) * point.z,
    z: -Math.sin(TILT) * point.y + Math.cos(TILT) * point.z,
  };
}

class RaceEngine {
  static async create(entries) {
    await initRapier();
    return new RaceEngine(entries);
  }

  constructor(entries) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / FPS;
    this.ticks = 0;
    this.winnerId = null;
    this.finishOrder = [];
    this.marbleBodies = new Map();
    this.entries = entries.map((entry) => ({ id: entry.id, design: entry.design }));

    const track = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setRotation(ROTATION),
    );
    const createTrackCollider = (descriptor) => this.world.createCollider(descriptor, track);

    createTrackCollider(
      RAPIER.ColliderDesc.cuboid(3.1, 0.15, 8)
        .setTranslation(0, -0.15, 0)
        .setFriction(0.65),
    );

    for (const x of [-3, 3]) {
      createTrackCollider(
        RAPIER.ColliderDesc.cuboid(0.17, 0.5, 8)
          .setTranslation(x, 0.43, 0)
          .setFriction(0.6),
      );
    }

    for (const [x, z] of BUMPERS) {
      createTrackCollider(
        RAPIER.ColliderDesc.cylinder(0.39, 0.38)
          .setTranslation(x, 0.39, z)
          .setRestitution(0.35),
      );
    }

    this.entries.forEach((entry, i) => {
      const x = -2.15 + (i % 6) * 0.86;
      const y = 2.5 + Math.floor(i / 24) * 0.8;
      const z = 4.55 + Math.floor((i % 24) / 6) * 0.68;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, y, z)
          .setCcdEnabled(true)
          .setLinearDamping(0.04)
          .setAngularDamping(0.04),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.ball(0.28)
          .setFriction(0.55)
          .setRestitution(0.28)
          .setDensity(1),
        body,
      );
      this.marbleBodies.set(entry.id, body);
    });
  }

  step() {
    if (this.winnerId || this.ticks >= MAX_SECONDS * FPS) return;
    this.world.step();
    this.ticks += 1;
    const newFinishers = [];

    for (const [id, body] of this.marbleBodies) {
      if (this.finishOrder.includes(id)) continue;
      const position = localCoordinates(body.translation());
      // Finish plane lies near the end of the bounded track.
      if (
        position.z <= -6.95 &&
        Math.abs(position.x) < 2.86 &&
        position.y > -0.7 &&
        position.y < 2
      ) {
        newFinishers.push(id);
      }
    }

    // A shared fixed timestep has a well-defined tie-breaker for simultaneous crossings.
    newFinishers.sort();
    this.finishOrder.push(...newFinishers);
    if (this.finishOrder.length && !this.winnerId) {
      this.winnerId = this.finishOrder[0];
    }
  }

  get done() {
    return Boolean(this.winnerId) || this.ticks >= MAX_SECONDS * FPS;
  }

  snapshot(roundId) {
    return {
      roundId,
      tick: this.ticks,
      elapsed: this.ticks / FPS,
      winnerId: this.winnerId,
      marbles: Array.from(this.marbleBodies, ([id, body]) => {
        const pos = body.translation();
        const rotation = body.rotation();
        const local = localCoordinates(pos);
        return {
          id,
          x: pos.x, y: pos.y, z: pos.z,
          qx: rotation.x, qy: rotation.y, qz: rotation.z, qw: rotation.w,
          progress: Math.max(0, Math.min(1, (5.4 - local.z) / 12.35)),
        };
      }),
    };
  }

  dispose() {
    this.world.free();
  }
}

module.exports = { RaceEngine };

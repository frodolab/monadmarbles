import { useCallback, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  CuboidCollider,
  CylinderCollider,
  Physics,
  RigidBody,
} from "@react-three/rapier";

const MARBLES = [
  { id: "01", color: "#a77cff", label: "Violet" },
  { id: "02", color: "#ffae57", label: "Orange" },
  { id: "03", color: "#54d9ec", label: "Cyan" },
  { id: "04", color: "#fa668e", label: "Rose" },
  { id: "05", color: "#c8f16b", label: "Lime" },
  { id: "06", color: "#ffe07a", label: "Gold" },
  { id: "07", color: "#6f89ff", label: "Blue" },
  { id: "08", color: "#64e4ba", label: "Mint" },
] as const;

const TRACK_TILT = -0.22;
const BUMPERS = [
  { x: -1.7, z: 2.2 },
  { x: 0.1, z: 1.0 },
  { x: 1.8, z: -0.3 },
  { x: -1.0, z: -2.1 },
  { x: 1.0, z: -3.7 },
];

function MarbleBodies() {
  return (
    <>
      {MARBLES.map((marble, i) => {
        const row = Math.floor(i / 4);
        const column = i % 4;
        return (
          <RigidBody
            key={marble.id}
            name={`marble-${marble.id}`}
            colliders="ball"
            position={[-2.1 + column * 1.4, 3.25 + row * 0.12, 5.2 + row * 1.1]}
            friction={0.55}
            restitution={0.28}
            linearDamping={0.04}
            angularDamping={0.04}
            ccd
          >
            <mesh castShadow>
              <sphereGeometry args={[0.32, 28, 28]} />
              <meshStandardMaterial
                color={marble.color}
                metalness={0.16}
                roughness={0.15}
              />
            </mesh>
          </RigidBody>
        );
      })}
    </>
  );
}

function Track({ onFinish }: { onFinish: (id: string) => void }) {
  return (
    <RigidBody type="fixed" colliders={false} rotation={[TRACK_TILT, 0, 0]}>
      <CuboidCollider args={[3.1, 0.15, 8]} position={[0, -0.15, 0]} />
      <mesh receiveShadow position={[0, -0.15, 0]}>
        <boxGeometry args={[6.2, 0.3, 16]} />
        <meshStandardMaterial color="#6952cf" roughness={0.72} />
      </mesh>

      {[-3.0, 3.0].map((x) => (
        <group key={x}>
          <CuboidCollider
            args={[0.17, 0.5, 8]}
            position={[x, 0.43, 0]}
          />
          <mesh castShadow receiveShadow position={[x, 0.43, 0]}>
            <boxGeometry args={[0.34, 1, 16]} />
            <meshStandardMaterial color="#a99bfa" roughness={0.45} />
          </mesh>
        </group>
      ))}

      {BUMPERS.map(({ x, z }, index) => (
        <group key={index}>
          <CylinderCollider args={[0.39, 0.38]} position={[x, 0.39, z]} />
          <mesh castShadow receiveShadow position={[x, 0.39, z]}>
            <cylinderGeometry args={[0.38, 0.38, 0.78, 24]} />
            <meshStandardMaterial
              color={index % 2 === 0 ? "#ffbb68" : "#76d9ec"}
              roughness={0.4}
            />
          </mesh>
        </group>
      ))}

      <mesh position={[0, 0.015, -6.95]}>
        <boxGeometry args={[5.6, 0.035, 0.25]} />
        <meshStandardMaterial color="#f9f1bb" emissive="#b59b42" emissiveIntensity={0.45} />
      </mesh>
      <CuboidCollider
        sensor
        args={[2.85, 0.7, 0.16]}
        position={[0, 0.42, -6.95]}
        onIntersectionEnter={({ other }) => {
          const name = other.rigidBodyObject?.name;
          if (name?.startsWith("marble-")) {
            onFinish(name.slice("marble-".length));
          }
        }}
      />
    </RigidBody>
  );
}

function RaceScene({ round, onFinish }: { round: number; onFinish: (id: string) => void }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.8]}
      camera={{ position: [10.5, 10.5, 15.5], fov: 49 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#080e22"]} />
      <fog attach="fog" args={["#080e22", 22, 45]} />
      <ambientLight intensity={1.4} />
      <hemisphereLight args={["#b4c7ff", "#322753", 1.2]} />
      <directionalLight position={[6, 13, 9]} intensity={3} castShadow shadow-mapSize={[2048, 2048]} />

      <Physics key={round} gravity={[0, -9.81, 0]} timeStep={1 / 60}>
        <Track onFinish={onFinish} />
        <MarbleBodies />
      </Physics>

      <OrbitControls
        target={[0, 0.8, 0]}
        minDistance={6}
        maxDistance={30}
        maxPolarAngle={Math.PI * 0.48}
      />
    </Canvas>
  );
}

export default function App() {
  const [round, setRound] = useState(1);
  const [winner, setWinner] = useState<string | null>(null);
  const [finishers, setFinishers] = useState<string[]>([]);

  const onFinish = useCallback((id: string) => {
    setWinner((current) => current ?? id);
    setFinishers((current) => current.includes(id) ? current : [...current, id]);
  }, []);

  const restart = () => {
    setRound((value) => value + 1);
    setWinner(null);
    setFinishers([]);
  };

  const champion = MARBLES.find((marble) => marble.id === winner);

  return (
    <main className="app">
      <div className="scene">
        <RaceScene round={round} onFinish={onFinish} />
      </div>

      <header className="header">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="eyebrow">MONAD · HACKATHON PROTOTYPE</div>
            <h1>MONAD <span>MARBLES</span></h1>
          </div>
        </div>
        <span className="chip"><span className="pulse" /> BETA 1 — LOCAL PHYSICS</span>
      </header>

      <section className="panel" aria-label="Race controls">
        <div className="panel-heading">RACE LAB <span>#{String(round).padStart(3, "0")}</span></div>
        <div className="stat-row">
          <span>Marbles</span>
          <strong>{MARBLES.length}</strong>
        </div>
        <div className="stat-row">
          <span>Crossed finish</span>
          <strong>{finishers.length}/{MARBLES.length}</strong>
        </div>
        <div className="winner">
          <span>FIRST TO FINISH WINS</span>
          {champion ? (
            <div className="winner-name">
              <i style={{ background: champion.color }} />
              {champion.label} · #{champion.id}
            </div>
          ) : (
            <div className="waiting">Race in progress…</div>
          )}
        </div>
        <button onClick={restart}>↻ &nbsp; Restart race</button>
        <p className="help">Drag to orbit · Scroll to zoom</p>
      </section>

      <footer className="footnote">
        Real 3D rigid-body physics · 8 demo marbles · No wallet or prize pool connected yet
      </footer>
    </main>
  );
}

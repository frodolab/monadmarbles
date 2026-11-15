import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { CuboidCollider, CylinderCollider, Physics, RigidBody } from "@react-three/rapier";
import { DESIGNS, type Entry } from "../game";

const TRACK_TILT = -0.22;
const BUMPERS = [
  { x: -1.7, z: 2.2 }, { x: 0.1, z: 1.0 }, { x: 1.8, z: -0.3 },
  { x: -1, z: -2.1 }, { x: 1, z: -3.7 },
];

function Track({ onFinish }: { onFinish: (id: string) => void }) {
  return (
    <RigidBody type="fixed" colliders={false} rotation={[TRACK_TILT, 0, 0]}>
      <CuboidCollider args={[3.1, 0.15, 8]} position={[0, -0.15, 0]} />
      <mesh receiveShadow position={[0, -0.15, 0]}>
        <boxGeometry args={[6.2, 0.3, 16]} />
        <meshStandardMaterial color="#6a55c5" roughness={0.66} />
      </mesh>

      {[-3, 3].map((x) => (
        <group key={x}>
          <CuboidCollider args={[0.17, 0.5, 8]} position={[x, 0.43, 0]} />
          <mesh castShadow receiveShadow position={[x, 0.43, 0]}>
            <boxGeometry args={[0.34, 1, 16]} />
            <meshStandardMaterial color="#b7a5fc" roughness={0.3} />
          </mesh>
        </group>
      ))}

      {BUMPERS.map(({ x, z }, i) => (
        <group key={i}>
          <CylinderCollider args={[0.39, 0.38]} position={[x, 0.39, z]} />
          <mesh castShadow receiveShadow position={[x, 0.39, z]}>
            <cylinderGeometry args={[0.38, 0.38, 0.78, 24]} />
            <meshStandardMaterial color={i % 2 ? "#8be3ed" : "#ffbf79"} roughness={0.32} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, 0.015, -6.95]}>
        <boxGeometry args={[5.6, 0.035, 0.25]} />
        <meshStandardMaterial color="#fff1ae" emissive="#ad9138" emissiveIntensity={0.45} />
      </mesh>
      <CuboidCollider
        sensor
        args={[2.85, 0.7, 0.16]}
        position={[0, 0.42, -6.95]}
        onIntersectionEnter={({ other }) => {
          const name = other.rigidBodyObject?.name;
          if (name?.startsWith("marble:")) onFinish(name.slice("marble:".length));
        }}
      />
    </RigidBody>
  );
}

function Marbles({ entries }: { entries: Entry[] }) {
  return (
    <>
      {entries.map((entry, i) => (
        <RigidBody
          key={entry.id}
          name={"marble:" + entry.id}
          colliders="ball"
          position={[
            -2.15 + (i % 6) * 0.86,
            2.5 + Math.floor(i / 24) * 0.8,
            4.55 + Math.floor((i % 24) / 6) * 0.68,
          ]}
          friction={0.55}
          restitution={0.28}
          linearDamping={0.04}
          angularDamping={0.04}
          ccd
        >
          <mesh castShadow>
            <sphereGeometry args={[0.28, 24, 24]} />
            <meshStandardMaterial
              color={DESIGNS[entry.design]?.color || "#b58aff"}
              roughness={0.15}
              metalness={0.18}
            />
          </mesh>
        </RigidBody>
      ))}
    </>
  );
}

export default function RaceScene({
  entries, roundId, onFinish,
}: {
  entries: Entry[];
  roundId: number;
  onFinish: (id: string) => void;
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.7]}
      camera={{ position: [10.5, 10.5, 15.5], fov: 49 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#0b1025"]} />
      <fog attach="fog" args={["#0b1025", 22, 45]} />
      <ambientLight intensity={1.4} />
      <hemisphereLight args={["#b4c7ff", "#322753", 1.2]} />
      <directionalLight position={[6, 13, 9]} intensity={3} castShadow shadow-mapSize={[2048, 2048]} />
      <Physics key={roundId} gravity={[0, -9.81, 0]} timeStep={1 / 60}>
        <Track onFinish={onFinish} />
        <Marbles entries={entries} />
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

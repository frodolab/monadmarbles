import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { CuboidCollider, CylinderCollider, Physics, RigidBody } from "@react-three/rapier";
import { DoubleSide } from "three";
import { DESIGNS, type Entry } from "../game";

function GlassBowl() {
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.13, 2.38]} position={[0, -1.04, 0]} />
        {Array.from({ length: 26 }, (_, index) => {
          const angle = (index / 26) * Math.PI * 2;
          return (
            <CuboidCollider
              key={index}
              args={[0.12, 1.13, 0.56]}
              position={[Math.cos(angle) * 2.46, 0, Math.sin(angle) * 2.46]}
              rotation={[0, -angle, 0]}
            />
          );
        })}
      </RigidBody>

      <mesh position={[0, 0, 0]} renderOrder={3}>
        <cylinderGeometry args={[2.55, 2.35, 2.2, 64, 1, true]} />
        <meshPhysicalMaterial
          color="#b9d8ff"
          metalness={0.12}
          roughness={0.06}
          transparent
          opacity={0.19}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      <mesh position={[0, -1.19, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.44, 64]} />
        <meshStandardMaterial color="#242653" roughness={0.28} metalness={0.38} />
      </mesh>
      <mesh position={[0, 1.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.55, 0.085, 12, 72]} />
        <meshStandardMaterial color="#d7b8ff" metalness={0.55} roughness={0.23} />
      </mesh>
      <mesh position={[0, -1.22, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.35, 0.1, 10, 64]} />
        <meshStandardMaterial color="#7966bc" metalness={0.36} roughness={0.31} />
      </mesh>
    </>
  );
}

function LobbyMarbles({ entries }: { entries: Entry[] }) {
  return (
    <>
      {entries.map((entry, index) => {
        const angle = index * 2.39996;
        const radius = Math.min(1.7, 0.35 + Math.sqrt(index % 28) * 0.23);
        return (
          <RigidBody
            key={entry.id}
            position={[
              Math.cos(angle) * radius,
              2.1 + (index % 7) * 0.18,
              Math.sin(angle) * radius,
            ]}
            colliders="ball"
            friction={0.65}
            restitution={0.17}
            linearDamping={0.35}
            angularDamping={0.5}
            ccd
          >
            <mesh castShadow>
              <sphereGeometry args={[0.3, 22, 22]} />
              <meshStandardMaterial
                color={DESIGNS[entry.design]?.color || "#b58aff"}
                metalness={0.32}
                roughness={0.15}
              />
            </mesh>
          </RigidBody>
        );
      })}
    </>
  );
}

export default function BowlScene({ entries, roundId }: { entries: Entry[]; roundId: number }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [7.5, 5.5, 9], fov: 42 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#0b1025"]} />
      <fog attach="fog" args={["#0b1025", 20, 36]} />
      <ambientLight intensity={1.25} />
      <hemisphereLight args={["#cac4ff", "#2d285b", 1.0]} />
      <spotLight position={[6, 11, 3]} intensity={110} angle={0.8} penumbra={0.8} castShadow />
      <pointLight position={[-5, 4, -2]} color="#a78bfa" intensity={48} />
      <Physics key={roundId} gravity={[0, -9.81, 0]} timeStep={1 / 60}>
        <GlassBowl />
        <LobbyMarbles entries={entries} />
      </Physics>
      <OrbitControls
        target={[0, 0.3, 0]}
        minDistance={5.5}
        maxDistance={17}
        maxPolarAngle={Math.PI * 0.51}
        enablePan={false}
      />
    </Canvas>
  );
}

import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Mesh, Quaternion, Vector3 } from "three";
import { DESIGNS, type Entry, type MarbleFrame, type RaceFrame } from "../game";

const TRACK_TILT = -0.22;
const BUMPERS = [
  { x: -1.7, z: 2.2 }, { x: 0.1, z: 1.0 }, { x: 1.8, z: -0.3 },
  { x: -1, z: -2.1 }, { x: 1, z: -3.7 },
];

function TrackVisuals() {
  return (
    <group rotation={[TRACK_TILT, 0, 0]}>
      <mesh receiveShadow position={[0, -0.15, 0]}>
        <boxGeometry args={[6.2, 0.3, 16]} />
        <meshStandardMaterial color="#6a55c5" roughness={0.66} />
      </mesh>
      {[-3, 3].map((x) => (
        <mesh key={x} castShadow receiveShadow position={[x, 0.43, 0]}>
          <boxGeometry args={[0.34, 1, 16]} />
          <meshStandardMaterial color="#b7a5fc" roughness={0.3} />
        </mesh>
      ))}
      {BUMPERS.map(({ x, z }, i) => (
        <mesh key={i} castShadow receiveShadow position={[x, 0.39, z]}>
          <cylinderGeometry args={[0.38, 0.38, 0.78, 24]} />
          <meshStandardMaterial
            color={i % 2 ? "#8be3ed" : "#ffbf79"}
            roughness={0.32}
          />
        </mesh>
      ))}
      <mesh position={[0, 0.015, -6.95]}>
        <boxGeometry args={[5.6, 0.035, 0.25]} />
        <meshStandardMaterial
          color="#fff1ae"
          emissive="#ad9138"
          emissiveIntensity={0.45}
        />
      </mesh>
    </group>
  );
}

function MarbleVisual({ entry, sample, index, highlighted }: {
  entry: Entry;
  sample?: MarbleFrame;
  index: number;
  highlighted: boolean;
}) {
  const mesh = useRef<Mesh>(null);
  const firstSample = useRef(true);
  const targetPosition = useMemo(() => new Vector3(), []);
  const targetRotation = useMemo(() => new Quaternion(), []);

  useFrame((_, delta) => {
    if (!mesh.current || !sample) return;
    targetPosition.set(sample.x, sample.y, sample.z);
    targetRotation.set(sample.qx, sample.qy, sample.qz, sample.qw);
    if (firstSample.current) {
      mesh.current.position.copy(targetPosition);
      mesh.current.quaternion.copy(targetRotation);
      firstSample.current = false;
      return;
    }
    const alpha = 1 - Math.exp(-18 * Math.min(delta, 0.1));
    mesh.current.position.lerp(targetPosition, alpha);
    mesh.current.quaternion.slerp(targetRotation, alpha);
  });

  const row = Math.floor(index / 24);
  return (
    <mesh
      ref={mesh}
      castShadow
      position={[
        -2.15 + (index % 6) * 0.86,
        2.5 + row * 0.8,
        4.55 + Math.floor((index % 24) / 6) * 0.68,
      ]}
    >
      {highlighted && (
        <mesh scale={1.35}>
          <sphereGeometry args={[0.28, 24, 24]} />
          <meshBasicMaterial color="#ffdc68" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      )}
      <sphereGeometry args={[0.28, 24, 24]} />
      <meshStandardMaterial
        color={DESIGNS[entry.design]?.color || "#b58aff"}
        roughness={0.15}
        metalness={0.18}
      />
    </mesh>
  );
}

function CameraDirector({ leaderPositions, enabled }: {
  leaderPositions: MarbleFrame[];
  enabled: boolean;
}) {
  const { camera } = useThree();
  const focus = useRef(new Vector3(0, 0.8, 0));
  const targetFocus = useMemo(() => new Vector3(), []);
  const targetCamera = useMemo(() => new Vector3(), []);

  useFrame((_, dt) => {
    if (!enabled || !leaderPositions.length) return;
    targetFocus.set(0, 0, 0);
    for (const marble of leaderPositions) {
      targetFocus.x += marble.x;
      targetFocus.y += marble.y;
      targetFocus.z += marble.z;
    }
    targetFocus.divideScalar(leaderPositions.length);
    targetFocus.y += 0.3;

    const factor = 1 - Math.exp(-2.4 * Math.min(dt, 0.1));
    focus.current.lerp(targetFocus, factor);
    targetCamera.set(
      focus.current.x + 9.4,
      focus.current.y + 8.7,
      focus.current.z + 11.8,
    );
    camera.position.lerp(targetCamera, factor);
    camera.lookAt(focus.current);
  });

  return null;
}

export default function RaceScene({
  entries, frame, autoFollow = true, myEntryId,
}: {
  entries: Entry[];
  roundId: number;
  frame: RaceFrame | null;
  autoFollow?: boolean;
  myEntryId?: string | null;
}) {
  const marblesById = useMemo(
    () => new Map(frame?.marbles.map((marble) => [marble.id, marble]) || []),
    [frame],
  );
  const leaders = useMemo(
    () => [...(frame?.marbles || [])]
      .sort((a, b) => b.progress - a.progress)
      .slice(0, Math.min(12, frame?.marbles.length || 0)),
    [frame],
  );

  return (
    <Canvas
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [10.5, 10.5, 15.5], fov: 49 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#0b1025"]} />
      <fog attach="fog" args={["#0b1025", 22, 45]} />
      <ambientLight intensity={1.4} />
      <hemisphereLight args={["#b4c7ff", "#322753", 1.2]} />
      <directionalLight
        position={[6, 13, 9]}
        intensity={3}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />

      <TrackVisuals />
      {entries.map((entry, index) => (
        <MarbleVisual
          key={entry.id}
          entry={entry}
          index={index} highlighted={entry.id === myEntryId}
          sample={marblesById.get(entry.id)}
        />
      ))}

      <CameraDirector leaderPositions={leaders} enabled={autoFollow} />
      <OrbitControls
        enabled={!autoFollow}
        target={[0, 0.8, 0]}
        minDistance={6}
        maxDistance={30}
        maxPolarAngle={Math.PI * 0.48}
      />
    </Canvas>
  );
}

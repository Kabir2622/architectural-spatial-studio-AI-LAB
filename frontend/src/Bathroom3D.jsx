import { Component, memo, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, ContactShadows, Html, Environment, Lightformer, RoundedBox } from '@react-three/drei';
import SavedLayoutComparison from './SavedLayoutComparison';
import useStudioActivity from './useStudioActivity';
import StudioResolution from './StudioResolution';
import StaticFixtureBatch from './StaticFixtureBatch';
import StudioAntialiasing from './StudioAntialiasing';
import StudioMaterialBudget from './StudioMaterialBudget';
import StudioBackdrop from './StudioBackdrop';
import { FixtureCollisionMonitor, FixtureCollisionHighlight } from './FixtureCollision';
import { doorFootprint } from './fixtureCollisions';
import { savedPreset } from './restoreLayout';

// --- Finish Library ---
const FINISH_PRESETS = {
  brass: { label: 'Moderne Brass', color: '#c5a367', metalness: 1, roughness: 0.2, swatch: '#c5a367' },
  matteBlack: { label: 'Matte Black', color: '#1a1f26', metalness: 0.2, roughness: 0.8, swatch: '#1a1f26' },
  chrome: { label: 'Polished Chrome', color: '#f1f5f9', metalness: 0.95, roughness: 0.08, swatch: '#cbd5e1' },
  titanium: { label: 'Titanium', color: '#64748b', metalness: 0.78, roughness: 0.32, swatch: '#64748b' }
};

// --- Wall Paint Palettes ---
const WALL_PAINT_PRESETS = {
  chalkWhite: { label: 'Chalk White', color: '#ddd5c7', swatch: '#ddd5c7' },
  urbanGrey: { label: 'Urban Grey', color: '#94a3b8', swatch: '#94a3b8' },
  cashmereBeige: { label: 'Cashmere Beige', color: '#c8b9a3', swatch: '#c8b9a3' },
  midnightNavy: { label: 'Midnight Navy', color: '#0f172a', swatch: '#0f172a' }
};

// --- Architectural Lighting Environments ---
const LIGHTING_MODES = {
  daylight: {
    label: 'Natural Daylight',
    ambientColor: '#f8fafc',
    ambientIntensity: 0.6,
    sunColor: '#ffffff',
    sunIntensity: 2.3,
    sunPos: [10, 16, 10],
    floorColor: '#cbd5e1',
    mirrorLightColor: '#ffffff',
    mirrorIntensity: 0.4
  },
  warmEvening: {
    label: 'Warm Evening',
    ambientColor: '#fff7ed',
    ambientIntensity: 0.5,
    sunColor: '#fef3c7',
    sunIntensity: 1.85,
    sunPos: [8, 14, 8],
    floorColor: '#e2e8f0',
    mirrorLightColor: '#fde68a',
    mirrorIntensity: 0.9
  },
  spaNight: {
    label: 'Spa Glow',
    ambientColor: '#1e293b',
    ambientIntensity: 0.2,
    sunColor: '#38bdf8',
    sunIntensity: 0.5,
    sunPos: [0, 12, -6],
    floorColor: '#0f172a',
    mirrorLightColor: '#c5a059',
    mirrorIntensity: 1.8
  }
};

// Deterministic, seamless PBR maps; no network or asset-loading dependency.
const surfacePixels = new Map();
function createSurfaceMaps(kind, repeatX, repeatY, tileColor = '#ffffff') {
  const size = 256;
  const tileTint = new THREE.Color(tileColor).convertLinearToSRGB().toArray().map(value => value * 255);
  const pixelKey = kind === 'tile' ? `${kind}:${tileColor}` : kind;
  let buffers = surfacePixels.get(pixelKey);
  if (!buffers) {
  buffers = [new Uint8Array(size * size * 4), new Uint8Array(size * size * 4), new Uint8Array(size * size * 4)];
  const tau = Math.PI * 2;
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const noise = (x, y, period) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const sample = (dx, dy) => hash(((ix + dx) % period + period) % period, ((iy + dy) % period + period) % period);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(sample(0, 0), sample(1, 0), sx), THREE.MathUtils.lerp(sample(0, 1), sample(1, 1), sx), sy);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * tau;
      const v = y / size * tau;
      const cloud = noise(x / size * 4, y / size * 4, 4) * 0.55 + noise(x / size * 16, y / size * 16, 16) * 0.3 + noise(x / size * 64, y / size * 64, 64) * 0.15 - 0.5;
      const grain = hash(x, y) - 0.5;
      let rgb, height, roughness;
      if (kind === 'walnut') {
        const line = Math.pow(Math.abs(Math.sin(u * 36 + Math.sin(v * 2) * 1.5 + cloud * 2)), 10);
        const tone = 1 + cloud * 0.28 - line * 0.28 + grain * 0.04;
        rgb = [83 * tone, 53 * tone, 34 * tone];
        height = 150 - line * 50;
        roughness = 110 + line * 25;
      } else if (kind === 'marble') {
        const vein = Math.pow(1 - Math.abs(Math.sin(u + v * 2 + cloud * 7)), 32);
        const hairline = Math.pow(1 - Math.abs(Math.sin(u * 3 - v * 4 + cloud * 9)), 64);
        rgb = [43 + cloud * 13 + vein * 99 + hairline * 24, 37 + cloud * 11 + vein * 89 + hairline * 22, 32 + cloud * 10 + vein * 72 + hairline * 19];
        height = 128 + vein * 8;
        roughness = 88 + cloud * 12 - vein * 15;
      } else if (kind === 'tile') {
        const grout = x < 3 || y < 3 || x >= size - 3 || y >= size - 3;
        const tone = 242 + cloud * 2 + grain;
        rgb = tileTint.map(channel => channel * (grout ? 0.68 : tone / 255));
        height = grout ? 50 : 220;
        roughness = grout ? 220 : 58 + cloud * 6;
      } else {
        const tone = 230 + cloud * 22 + grain * 5;
        rgb = [tone, tone - 3, tone - 8];
        height = 128 + cloud * 32 + grain * 16;
        roughness = 218 + cloud * 15;
      }
      const i = (y * size + x) * 4;
      buffers[0].set([...rgb.map(value => Math.max(0, Math.min(255, Math.round(value)))), 255], i);
      buffers[1].set([height, height, height, 255], i);
      buffers[2].set([roughness, roughness, roughness, 255], i);
    }
  }
  surfacePixels.set(pixelKey, buffers);
  if (surfacePixels.size > 16) surfacePixels.delete(surfacePixels.keys().next().value);
  }
  const textures = buffers.map((data, index) => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.colorSpace = index === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  });
  return { map: textures[0], bumpMap: textures[1], roughnessMap: textures[2] };
}

function useSurfaceMaps(kind, repeatX = 1, repeatY = 1, tileColor = '#ffffff') {
  const maps = useMemo(() => createSurfaceMaps(kind, repeatX, repeatY, tileColor), [kind, repeatX, repeatY, tileColor]);
  useEffect(() => {
    // StrictMode replays setup after cleanup; re-upload retained CPU data.
    Object.values(maps).forEach(texture => { texture.needsUpdate = true; });
    return () => Object.values(maps).forEach(texture => texture.dispose());
  }, [maps]);
  return maps;
}

// A closed, hollow ceramic shell: outer base, rolled rim, inner bowl, inner floor.
function CeramicBowl({ basin = false, color = '#ffffff', hasConflict = false, isSelected = false, ...props }) {
  const points = useMemo(() => {
    const profile = basin
      ? [[0, 0], [0.52, 0], [0.64, 0.04], [0.73, 0.18], [0.75, 0.24], [0.73, 0.26], [0.70, 0.24], [0.64, 0.12], [0.49, 0.06], [0, 0.06]]
      : [[0, 0.06], [0.77, 0.06], [0.87, 0.13], [0.94, 0.32], [1.05, 0.85], [1.18, 1.40], [1.19, 1.46], [1.16, 1.49], [1.12, 1.46], [1.11, 1.39], [0.99, 0.88], [0.86, 0.39], [0.73, 0.25], [0, 0.25]];
    const curve = new THREE.SplineCurve(profile.map(([radius, height]) => new THREE.Vector2(radius, height)));
    return curve.getPoints(96).map(point => new THREE.Vector2(Math.max(0, point.x), point.y));
  }, [basin]);
  return (
    <mesh {...props} castShadow receiveShadow={false}>
      <latheGeometry args={[points, 64]} />
      <meshPhysicalMaterial fog={false} color={color} roughness={0.14} metalness={0} clearcoat={1} clearcoatRoughness={0.06}
        emissive={hasConflict ? '#991b1b' : isSelected ? '#1e3a8a' : '#000000'}
        emissiveIntensity={hasConflict ? 0.3 : isSelected ? 0.04 : 0} />
    </mesh>
  );
}

function StudioEnvironment({ night }) {
  return (
    <Environment key={night ? 'night' : 'day'} resolution={256} frames={1} environmentIntensity={night ? 0.35 : 0.75}>
      <color attach="background" args={['#aaa092']} />
      <Lightformer form="rect" intensity={4} color="#fff3df" position={[-8, 10, 6]} target={[0, 0, 0]} scale={[8, 12, 1]} />
      <Lightformer form="rect" intensity={3} color="#ffffff" position={[7, 8, 3]} target={[0, 2, 0]} scale={[5, 10, 1]} />
      <Lightformer form="rect" intensity={2} color="#e4edff" position={[0, 12, -4]} target={[0, 0, 0]} scale={[10, 5, 1]} />
    </Environment>
  );
}

// Procedural studio reflections are available immediately, even offline.
const RoomEnvironment = memo(function RoomEnvironment({ night }) {
  return <StudioEnvironment night={night} />;
});

// A renderer failure must produce an actionable message, not an empty stage.
class StudioBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div role="alert" style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center', color: '#e2e8f0', background: '#0a0d14', padding: 24 }}>
      <strong>The 3D studio could not start.</strong>
      <p style={{ maxWidth: 460, fontSize: 13 }}>{this.state.error.message}</p>
      <button type="button" onClick={this.props.onRetry} style={{ padding: '10px 18px', borderRadius: 20, background: '#c5a367', border: 0, cursor: 'pointer' }}>Reload 3D studio</button>
    </div>;
  }
}

function StudioHealth({ onReady, onContextLost, onContextRestored }) {
  const { gl, camera } = useThree();
  const rendererId = useRef(THREE.MathUtils.generateUUID());
  const frames = useRef({ count: 0, elapsed: 0, ready: false });
  useEffect(() => {
    const canvas = gl.domElement;
    camera.layers.enable(1);
    canvas.setAttribute('data-renderer-id', rendererId.current);
    const lost = event => { event.preventDefault(); onReady(false); onContextLost(true); };
    const restored = () => { onContextLost(false); onContextRestored?.(); };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, [gl, camera, onReady, onContextLost, onContextRestored]);
  useFrame((_, delta) => {
    const sample = frames.current;
    if (!sample.ready) { sample.ready = true; onReady(true); }
    sample.count++;
    sample.elapsed += Math.min(delta, 0.1);
    if (sample.elapsed >= 1) {
      // A DOM diagnostic lets development checks read actual rendered FPS.
      gl.domElement.setAttribute('data-fps', String(Math.round(sample.count / sample.elapsed)));
      sample.count = 0; sample.elapsed = 0;
    }
  });
  return null;
}

// Hide exterior walls while the presentation turns behind the cutaway room.
function CutawayWall({ axis, boundary, plan, children }) {
  const group = useRef();
  const materials = useRef([]);
  const { camera, invalidate } = useThree();
  useLayoutEffect(() => {
    const list = [];
    group.current.traverse(object => {
      if (object.isMesh) {
        object.material.transparent = object.material.opacity < 0.998;
        object.material.needsUpdate = true;
        list.push(object.material);
      }
    });
    materials.current = list;
  }, []);
  useFrame((_, delta) => {
    const target = plan || camera.position[axis] < boundary ? 0.08 : 1;
    for (const material of materials.current) {
      if (Math.abs(material.opacity - target) < 0.002) continue;
      const opacity = THREE.MathUtils.damp(material.opacity, target, 10, Math.min(delta, 0.05));
      const transparent = opacity < 0.998;
      if (material.transparent !== transparent) {
        Object.assign(material, { transparent, needsUpdate: true });
      }
      // Opaque walls use early depth rejection instead of the late transparent
      // pass. The cutaway fade retains its existing appearance and timing.
      Object.assign(material, { opacity, depthWrite: opacity > 0.98 });
      invalidate();
    }
  });
  return <group ref={group}>{children}</group>;
}

// Catalog footprints use inches; scene dimensions use feet. Model buffers stay
// reusable when the selected product changes: only the memoized transform changes.
const MODEL_DIMENSIONS = {
  bathtub: { width: 4.284, depth: 2.38, height: 2.8 },
  vanity: { width: 3.5, depth: 2.1, height: 6.3 },
  shower: { width: 3.8, depth: 3.8, height: 7.14 },
  toilet: { width: 1.3, depth: 1.91, height: 2.45 }
};
const EMPTY_PRODUCTS = Object.freeze({});
const DEFAULT_FOOTPRINTS = { bathtub: { width: 6, depth: 3 }, vanity: { width: 3.5, depth: 2.1 },
  toilet: { width: 1.5, depth: 2.4 }, shower: { width: 3.8, depth: 3.8 } };

function resolveProductDimensions(category, product) {
  const base = MODEL_DIMENSIONS[category];
  const fallback = DEFAULT_FOOTPRINTS[category];
  const inches = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number / 12 : null;
  };
  const productWidth = inches(product?.footprint_in?.width);
  const productDepth = inches(product?.footprint_in?.depth);
  // Small catalog shower footprints describe the head, not an enclosure.
  const headOnly = category === 'shower' && productWidth !== null && productDepth !== null
    && productWidth < 2 && productDepth < 2;
  const width = headOnly ? base.width : productWidth ?? fallback.width;
  const depth = headOnly ? base.depth : productDepth ?? fallback.depth;
  return { width, depth, height: base.height,
    scale: [width / base.width, 1, depth / base.depth],
    headScale: headOnly ? [productWidth / 1.4, 1, productDepth / 1.4] : [1, 1, 1] };
}

function rotatedFootprint(dimensions, rotation) {
  const angle = rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  return { width: dimensions.width * cos + dimensions.depth * sin,
    depth: dimensions.width * sin + dimensions.depth * cos };
}

// Pointer movement writes only to a mutable target. React receives one final
// position on release; the demand loop draws at most once per animation frame.
function DraggableFixture({ id, position, width, depth, enabled, walkthrough, onStart, onCommit, onRegister, overlapping = false, controlsRef, dimensions = MODEL_DIMENSIONS.bathtub, rotation = 0, children }) {
  const group = useRef();
  const drag = useRef(null);
  const { camera, gl, invalidate } = useThree();
  useLayoutEffect(() => {
    onRegister?.(id, { object: group.current, dimensions, rotation });
    return () => onRegister?.(id, null);
  }, [id, dimensions, rotation, onRegister]);
  const limits = useMemo(() => {
    const footprint = rotatedFootprint(dimensions, rotation);
    return { x: Math.max(0, (width - footprint.width) / 2 - 0.06),
      z: Math.max(0, (depth - footprint.depth) / 2 - 0.06) };
  }, [dimensions, rotation, width, depth]);
  const scratch = useMemo(() => ({
    raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(), hit: new THREE.Vector3(),
    plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    localRay: new THREE.Ray(), inverse: new THREE.Matrix4(), world: new THREE.Matrix4(),
    rotation: new THREE.Matrix4(), pickPoint: new THREE.Vector3(), box: new THREE.Box3()
  }), []);

  // An analytic box hit replaces triangle picking. Returning false also stops
  // Three's recursive traversal into the detailed visual geometry.
  const pickFixture = useCallback((raycaster, intersections) => {
    const object = group.current;
    if (!object || !enabled) return false;
    scratch.rotation.makeRotationY(rotation * Math.PI / 180);
    scratch.world.copy(object.matrixWorld).multiply(scratch.rotation);
    scratch.inverse.copy(scratch.world).invert();
    scratch.localRay.copy(raycaster.ray).applyMatrix4(scratch.inverse);
    scratch.box.min.set(-dimensions.width / 2, 0, -dimensions.depth / 2);
    scratch.box.max.set(dimensions.width / 2, dimensions.height, dimensions.depth / 2);
    if (scratch.localRay.intersectBox(scratch.box, scratch.pickPoint)) {
      scratch.pickPoint.applyMatrix4(scratch.world);
      const distance = raycaster.ray.origin.distanceTo(scratch.pickPoint);
      if (distance >= raycaster.near && distance <= raycaster.far) {
        intersections.push({ distance, point: scratch.pickPoint.clone(), object });
      }
    }
    return false;
  }, [dimensions, enabled, rotation, scratch]);

  const updateLockedTarget = useCallback(() => {
    const current = drag.current;
    if (current?.locked) {
      // Pointer-lock has no useful screen coordinates. Carry the fixture in
      // front of the camera at its original horizontal reach, on the floor.
      const direction = camera.getWorldDirection(scratch.hit);
      const length = Math.hypot(direction.x, direction.z);
      if (length > 0.001) {
        current.target.set(
          THREE.MathUtils.clamp(camera.position.x + direction.x / length * current.reach + current.offset.x, -limits.x, limits.x),
          0,
          THREE.MathUtils.clamp(camera.position.z + direction.z / length * current.reach + current.offset.z, -limits.z, limits.z)
        );
      }
    }
  }, [camera, limits, scratch]);

  useFrame(() => {
    const current = drag.current;
    if (!current || !group.current) return;
    if (current.locked) { updateLockedTarget(); invalidate(); }
    group.current.position.copy(current.target);
  });

  useEffect(() => {
    const canvas = gl.domElement;
    const move = event => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      if (current.locked) { invalidate(); return; }
      scratch.pointer.set(
        (event.clientX - current.rect.left) / current.rect.width * 2 - 1,
        -(event.clientY - current.rect.top) / current.rect.height * 2 + 1
      );
      scratch.raycaster.setFromCamera(scratch.pointer, camera);
      if (!scratch.raycaster.ray.intersectPlane(scratch.plane, scratch.hit)) return;
      current.target.set(
        THREE.MathUtils.clamp(scratch.hit.x + current.offset.x, -limits.x, limits.x),
        0,
        THREE.MathUtils.clamp(scratch.hit.z + current.offset.z, -limits.z, limits.z)
      );
      invalidate();
    };
    const finish = event => {
      const current = drag.current;
      if (!current || (event.pointerId !== undefined && event.pointerId !== current.pointerId)) return;
      if (event.type === 'pointerup') {
        if (current.locked) updateLockedTarget();
        else move(event);
      }
      const cancelled = event.type === 'pointercancel' || event.type === 'blur';
      const finalPosition = cancelled ? current.origin : current.target;
      group.current?.position.copy(finalPosition);
      drag.current = null;
      if (canvas.hasPointerCapture(current.pointerId)) canvas.releasePointerCapture(current.pointerId);
      if (controlsRef.current) controlsRef.current.enabled = current.controlsEnabled;
      onCommit(id, finalPosition.toArray());
      invalidate();
    };
    const escape = event => {
      if (event.key === 'Escape') finish({ type: 'pointercancel' });
    };
    const unlock = () => {
      if (drag.current?.locked && document.pointerLockElement !== canvas) finish({ type: 'pointercancel' });
    };
    canvas.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    window.addEventListener('keydown', escape);
    document.addEventListener('pointerlockchange', unlock);
    canvas.addEventListener('lostpointercapture', finish);
    return () => {
      canvas.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      window.removeEventListener('keydown', escape);
      document.removeEventListener('pointerlockchange', unlock);
      canvas.removeEventListener('lostpointercapture', finish);
    };
  }, [camera, controlsRef, gl, id, invalidate, limits, onCommit, scratch, updateLockedTarget]);

  return (
    <group ref={group} position={position} raycast={pickFixture} onPointerDown={event => {
      if (!enabled || event.button !== 0 || drag.current || controlsRef.current?.enabled === false) return;
      event.stopPropagation();
      const origin = group.current.position.clone();
      const locked = walkthrough && document.pointerLockElement === gl.domElement;
      const reach = Math.hypot(origin.x - camera.position.x, origin.z - camera.position.z);
      if (locked) {
        const direction = event.ray.direction;
        const length = Math.hypot(direction.x, direction.z);
        if (length < 0.001) return;
        scratch.hit.set(camera.position.x + direction.x / length * reach, 0, camera.position.z + direction.z / length * reach);
      } else if (!event.ray.intersectPlane(scratch.plane, scratch.hit)) return;
      drag.current = {
        locked, reach,
        pointerId: event.pointerId, rect: gl.domElement.getBoundingClientRect(),
        origin, target: origin.clone(), offset: origin.clone().sub(scratch.hit),
        controlsEnabled: controlsRef.current?.enabled ?? true
      };
      if (controlsRef.current) controlsRef.current.enabled = false;
      if (!locked) gl.domElement.setPointerCapture(event.pointerId);
      onStart(id);
      invalidate();
    }}>
      <FixtureCollisionHighlight overlapping={overlapping}>
        <StaticFixtureBatch>{children}</StaticFixtureBatch>
      </FixtureCollisionHighlight>
    </group>
  );
}

// Scene Background Color Synchronizer
function SceneBackground() {
  return <><color attach="background" args={['#0a0d14']} /><fog attach="fog" args={['#0a0d14', 10, 40]} /></>;
}

// Camera Controller: Decoupled from room width & depth to eliminate slider jump/zoom
function fitStudioCamera(camera, width, depth, aspect, top) {
  if (camera.isOrthographicCamera) {
    const halfHeight = Math.max(depth / 2, width / (2 * Math.max(aspect, 0.1))) * 1.4;
    Object.assign(camera, { left: -halfHeight * aspect, right: halfHeight * aspect,
      top: halfHeight, bottom: -halfHeight });
    camera.position.set(0, 30, 0.001);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    return;
  }
  const target = new THREE.Vector3(0, top ? 0 : 3, 0);
  const back = new THREE.Vector3(top ? 0 : 1, top ? 1 : 0.68, top ? 0.001 : 1).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right).normalize();
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const horizontal = vertical * Math.max(aspect, 0.1);
  let distance = 0;
  const corner = new THREE.Vector3();
  for (const x of [-width / 2, width / 2]) for (const y of [0, 8.5]) for (const z of [-depth / 2, depth / 2]) {
    corner.set(x, y, z).sub(target);
    const along = corner.dot(back);
    distance = Math.max(distance, Math.abs(corner.dot(right)) / horizontal + along,
      Math.abs(corner.dot(up)) / vertical + along);
  }
  camera.position.copy(target).addScaledVector(back, distance * 1.18);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function PlanCamera({ width, depth }) {
  const { size } = useThree();
  const aspect = size.width / Math.max(size.height, 1);
  const halfHeight = Math.max(depth / 2, width / (2 * Math.max(aspect, 0.1))) * 1.4;
  return <OrthographicCamera makeDefault manual left={-halfHeight * aspect} right={halfHeight * aspect}
    top={halfHeight} bottom={-halfHeight} position={[0, 30, 0.001]} near={0.1} far={200} />;
}

// Perspective labels use distance scaling; Plan labels keep their CSS pixel size.
function StudioHtml({ distanceFactor, ...props }) {
  const { camera } = useThree();
  return <Html {...props} distanceFactor={camera.isOrthographicCamera ? undefined : distanceFactor} />;
}

function CameraController({ cameraView, width, depth }) {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    fitStudioCamera(camera, width, depth, size.width / Math.max(size.height, 1), cameraView === 'top');
    invalidate();
  }, [cameraView, camera, width, depth, size.width, size.height, invalidate]);
  return null;
}

// Interactive VR WASD Walkthrough Controller
function VRWalkthroughController({ enabled, width, depth, startAtEntry = true, paused = false }) {
  const { camera, invalidate } = useThree();
  const moveState = useRef({ forward: false, backward: false, left: false, right: false });
  const direction = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (!enabled) return;

    camera.position.set(startAtEntry ? -width / 2 + 1.2 : 0, 5.15, startAtEntry ? depth * 0.15 : depth / 2 - 1.2);
    camera.lookAt(0, 3.1, 0);
    invalidate();
    const reset = () => {
      Object.keys(moveState.current).forEach(key => { moveState.current[key] = false; });
    };

    const handleKeyDown = (e) => {
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
      switch (e.code) {
        case 'KeyW': moveState.current.forward = true; break;
        case 'KeyS': moveState.current.backward = true; break;
        case 'KeyA': moveState.current.left = true; break;
        case 'KeyD': moveState.current.right = true; break;
      }
      if (['KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) {
        e.preventDefault();
        invalidate();
      }
    };

    const handleKeyUp = (e) => {
      switch (e.code) {
        case 'KeyW': moveState.current.forward = false; break;
        case 'KeyS': moveState.current.backward = false; break;
        case 'KeyA': moveState.current.left = false; break;
        case 'KeyD': moveState.current.right = false; break;
      }
      if (['KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) invalidate();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', reset);
    return () => {
      reset();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', reset);
    };
  }, [enabled, startAtEntry, camera, width, depth, invalidate]);

  useFrame((_, delta) => {
    if (!enabled || paused) return;
    const keys = moveState.current;
    const forward = Number(keys.forward) - Number(keys.backward);
    const strafe = Number(keys.right) - Number(keys.left);
    if (!forward && !strafe) return;
    // Clamp the first delta after an idle demand loop; keep walking horizontal
    // and diagonal speed consistent even when looking up or down.
    const speed = 4.8 * Math.min(delta, 0.05) / Math.hypot(forward, strafe);
    camera.getWorldDirection(direction);
    direction.set(direction.x, 0, direction.z).normalize();

    const maxX = width / 2 - 1.2;
    const maxZ = depth / 2 - 1.2;
    camera.position.set(
      THREE.MathUtils.clamp(camera.position.x + (direction.x * forward - direction.z * strafe) * speed, -maxX, maxX),
      5.15,
      THREE.MathUtils.clamp(camera.position.z + (direction.z * forward + direction.x * strafe) * speed, -maxZ, maxZ)
    );
    invalidate();
  });

  return null;
}

function WalkthroughMouseLook() {
  const { camera, gl, get, setEvents, invalidate } = useThree();
  const look = useRef({ rightButton: false, x: 0, y: 0, rotation: new THREE.Euler(0, 0, 0, 'YXZ') });
  useEffect(() => {
    const canvas = gl.domElement;
    const ownerDocument = canvas.ownerDocument;
    const lookState = look.current;
    const previousCompute = get().events.compute;
    setEvents({ compute(event, state) {
      if (ownerDocument.pointerLockElement === canvas) {
        state.pointer.set(0, 0);
        state.raycaster.setFromCamera(state.pointer, state.camera);
      } else previousCompute(event, state);
    } });
    const lock = event => {
      if (event.button !== 0 || ownerDocument.pointerLockElement === canvas) return;
      // Some embedded browsers reject pointer lock. Keep right-drag mouse look
      // available and consume promise rejections from the browser API.
      try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* right-drag fallback */ }
    };
    const rightDown = event => {
      if (event.button !== 2) return;
      event.preventDefault();
      Object.assign(look.current, { rightButton: true, x: event.clientX, y: event.clientY });
    };
    const stop = event => {
      if (event.type === 'blur' || event.button === 2) look.current.rightButton = false;
    };
    const move = event => {
      const locked = ownerDocument.pointerLockElement === canvas;
      const state = look.current;
      if (!locked && !state.rightButton) return;
      const dx = locked ? event.movementX : event.clientX - state.x;
      const dy = locked ? event.movementY : event.clientY - state.y;
      state.x = event.clientX;
      state.y = event.clientY;
      state.rotation.setFromQuaternion(camera.quaternion);
      state.rotation.y -= dx * 0.002;
      state.rotation.x = THREE.MathUtils.clamp(state.rotation.x - dy * 0.002, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      camera.quaternion.setFromEuler(state.rotation);
      invalidate();
    };
    const contextMenu = event => event.preventDefault();
    canvas.addEventListener('click', lock);
    canvas.addEventListener('pointerdown', rightDown);
    canvas.addEventListener('contextmenu', contextMenu);
    ownerDocument.addEventListener('mousemove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('blur', stop);
    return () => {
      canvas.removeEventListener('click', lock);
      canvas.removeEventListener('pointerdown', rightDown);
      canvas.removeEventListener('contextmenu', contextMenu);
      ownerDocument.removeEventListener('mousemove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('blur', stop);
      lookState.rightButton = false;
      if (ownerDocument.pointerLockElement === canvas) ownerDocument.exitPointerLock();
      setEvents({ compute: previousCompute });
    };
  }, [camera, get, gl, invalidate, setEvents]);
  return null;
}

// Camera movement does not change world-space shadows. Reuse them until the
// room changes, and refresh at 20 Hz while moving a fixture.
function RenderBudget({ walkthrough, dragging, revision, fixtures }) {
  const { gl, invalidate } = useThree();
  const renderer = useRef(gl);
  const lastShadowUpdate = useRef(-Infinity);
  const initialShadows = useRef(2);
  const lastCasterPose = useRef('');
  useLayoutEffect(() => {
    const current = renderer.current;
    const previousAutoUpdate = current.shadowMap.autoUpdate;
    const previousTransmissionScale = current.transmissionResolutionScale;
    current.shadowMap.autoUpdate = false;
    current.transmissionResolutionScale = walkthrough ? 0.5 : 1;
    current.shadowMap.needsUpdate = true;
    invalidate();
    return () => {
      current.shadowMap.autoUpdate = previousAutoUpdate;
      current.transmissionResolutionScale = previousTransmissionScale;
      current.shadowMap.needsUpdate = true;
    };
  }, [walkthrough, invalidate]);
  useLayoutEffect(() => {
    renderer.current.shadowMap.needsUpdate = true;
    invalidate();
  }, [revision, invalidate]);
  useFrame(({ clock }) => {
    // Environment cube captures can consume the first shadow update during
    // mounting. Re-bake once the room is present before caching static shadows.
    if (initialShadows.current > 0) {
      renderer.current.shadowMap.needsUpdate = true;
      initialShadows.current--;
    }
    if (dragging && clock.elapsedTime - lastShadowUpdate.current >= 0.05) {
      const pose = fixtures ? Array.from(fixtures.current, ([id, fixture]) => {
        const position = fixture.object?.position;
        return position ? `${id}:${position.x},${position.y},${position.z}` : '';
      }).join(';') : String(clock.elapsedTime);
      if (pose !== lastCasterPose.current) {
        renderer.current.shadowMap.needsUpdate = true;
        lastCasterPose.current = pose;
      }
      lastShadowUpdate.current = clock.elapsedTime;
    }
  });
  return null;
}

// Cinematic Automated Recording Animator
function CinematicCameraAnimator({ isRecording, width, depth, onComplete }) {
  const { camera } = useThree();
  const startTimeRef = useRef(null);

  useFrame(({ clock }) => {
    if (!isRecording) {
      startTimeRef.current = null;
      return;
    }

    if (!startTimeRef.current) {
      startTimeRef.current = clock.getElapsedTime();
    }

    const elapsed = clock.getElapsedTime() - startTimeRef.current;
    const duration = 20.0;
    const progress = Math.min(elapsed / duration, 1.0);

    const waypoints = [
      { time: 0.00, pos: [-width / 2 + 0.8, 4.0, depth * 0.15], look: [0, 3.0, 0] },
      { time: 0.25, pos: [-3.2, 4.0, -2.0], look: [-4.8, 2.5, -4.2] },
      { time: 0.50, pos: [-3.0, 4.0, 2.2], look: [-5.0, 2.0, 3.8] },
      { time: 0.75, pos: [2.5, 4.0, -2.0], look: [4.8, 3.5, -4.2] },
      { time: 1.00, pos: [1.8, 3.8, 1.8], look: [3.8, 1.5, 3.5] }
    ];

    let curr = waypoints[0];
    let next = waypoints[1];
    for (let i = 0; i < waypoints.length - 1; i++) {
      if (progress >= waypoints[i].time && progress <= waypoints[i + 1].time) {
        curr = waypoints[i];
        next = waypoints[i + 1];
        break;
      }
    }

    const segmentDuration = next.time - curr.time;
    const segmentProgress = segmentDuration > 0 ? (progress - curr.time) / segmentDuration : 1;
    
    const ease = segmentProgress < 0.5
      ? 4 * segmentProgress * segmentProgress * segmentProgress
      : 1 - Math.pow(-2 * segmentProgress + 2, 3) / 2;

    const posX = curr.pos[0] + (next.pos[0] - curr.pos[0]) * ease;
    const posY = curr.pos[1] + (next.pos[1] - curr.pos[1]) * ease;
    const posZ = curr.pos[2] + (next.pos[2] - curr.pos[2]) * ease;

    const lookX = curr.look[0] + (next.look[0] - curr.look[0]) * ease;
    const lookY = curr.look[1] + (next.look[1] - curr.look[1]) * ease;
    const lookZ = curr.look[2] + (next.look[2] - curr.look[2]) * ease;

    camera.position.set(posX, posY, posZ);
    camera.lookAt(lookX, lookY, lookZ);

    if (progress >= 1.0 && onComplete) {
      onComplete();
    }
  });

  return null;
}

function FixtureBadge({ text, isSelected, hasConflict, position = [0, 2.5, 0], hideBadge }) {
  if (hideBadge) return null;
  return (
    <StudioHtml position={position} center distanceFactor={16}>
      <div
        style={{
          background: hasConflict ? 'rgba(55, 18, 22, 0.9)' : 'rgba(15, 20, 29, 0.86)',
          color: hasConflict ? '#fecaca' : isSelected ? '#e8c989' : '#f8fafc',
          border: hasConflict ? '1px solid #ef4444' : isSelected ? '1px solid #c5a059' : '1px solid rgba(255,255,255,0.2)',
          padding: '3px 10px',
          borderRadius: '20px',
          fontSize: '11px',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          fontFamily: 'Inter, Arial, sans-serif',
          letterSpacing: '0.04em',
          pointerEvents: 'none',
          boxShadow: isSelected ? '0 0 14px rgba(197,160,89,0.3), 0 4px 12px rgba(0,0,0,0.35)' : '0 0 8px rgba(148,163,184,0.18), 0 4px 12px rgba(0,0,0,0.4)'
        }}
      >
        {hasConflict ? `⚠️ CLEARANCE ENCROACHMENT` : text}
      </div>
    </StudioHtml>
  );
}

function InteractiveClearanceZone({
  width = 3.5,
  depth = 3.5,
  codeLabel = 'NKBA Standard',
  ruleText = '21" Front Clearance',
  isSelected = false,
  hasConflict = false,
  hideZone = false
}) {
  if (hideZone) return null;
  const accentColor = hasConflict ? '#ef4444' : '#38bdf8';
  const bgOpacity = hasConflict ? 0.18 : isSelected ? 0.055 : 0.015;

  return (
    <group position={[0, 0.02, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} onUpdate={object => object.layers.set(1)}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial fog={false} color={accentColor} transparent opacity={bgOpacity} />
      </mesh>

      {(isSelected || hasConflict) && (
        <StudioHtml position={[0, 0.02, depth / 2 + 0.4]} center distanceFactor={14}>
          <div
            style={{
              background: hasConflict ? 'rgba(45, 10, 10, 0.96)' : 'rgba(8, 12, 20, 0.96)',
              border: `1px solid ${accentColor}`,
              borderRadius: '20px',
              padding: '4px 10px',
              whiteSpace: 'nowrap',
              fontFamily: 'Inter, Arial, sans-serif',
              pointerEvents: 'none',
              boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '10px', fontWeight: 800, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {hasConflict ? '⚠️ CODE VIOLATION' : `✓ ${codeLabel}`}
            </div>
            <div style={{ fontSize: '9px', color: '#cbd5e1', marginTop: '1px' }}>
              {hasConflict ? 'Minimum 21" Egress Encroached' : ruleText}
            </div>
          </div>
        </StudioHtml>
      )}
    </group>
  );
}

function EntryDoor({ position, rotation = 0, finish = 'brass', doorWidth = 2.8, doorHeight = 7.0, open = false, onToggle, disabled = false, onRegister, overlapping = false }) {
  const wood = useSurfaceMaps('walnut', 1, 1);
  const finishMat = FINISH_PRESETS[finish] || FINISH_PRESETS.matteBlack;
  const hingeRef = useRef(null);
  const lastShadowUpdate = useRef(-Infinity);
  const { invalidate } = useThree();
  const jambDepth = 0.25;
  const jambThickness = 0.08;
  const slabThickness = 0.12;
  const targetAngle = open ? -Math.PI / 2 : 0;
  const hingeOrigin = useMemo(() => new THREE.Vector3(), []);

  useLayoutEffect(() => {
    onRegister?.('door', { getFootprint: () => {
      const hinge = hingeRef.current;
      hinge.getWorldPosition(hingeOrigin);
      return doorFootprint(hingeOrigin, rotation + THREE.MathUtils.radToDeg(hinge.rotation.y), doorWidth, slabThickness + 0.22);
    } });
    return () => onRegister?.('door', null);
  }, [onRegister, rotation, doorWidth, hingeOrigin]);

  useEffect(() => { invalidate(); }, [open, invalidate]);
  useFrame(({ clock, gl }, delta) => {
    const hinge = hingeRef.current;
    if (!hinge || Math.abs(hinge.rotation.y - targetAngle) < 0.0001) return;
    const nextAngle = THREE.MathUtils.damp(hinge.rotation.y, targetAngle, 8, Math.min(delta, 0.05));
    const settled = Math.abs(nextAngle - targetAngle) < 0.001;
    hinge.rotation.y = settled ? targetAngle : nextAngle;
    // Reuse the studio's cached shadows; only refresh them during the swing.
    if (settled || clock.elapsedTime - lastShadowUpdate.current >= 0.05) {
      gl.shadowMap.needsUpdate = true;
      lastShadowUpdate.current = clock.elapsedTime;
    }
    invalidate();
  });

  const toggleDoor = event => {
    if (disabled || (event.button !== undefined && event.button !== 0)) return;
    event.stopPropagation();
    onToggle?.();
  };

  return (
    <group position={position} rotation={[0, (rotation * Math.PI) / 180, 0]}>
      <mesh position={[doorWidth / 2, doorHeight + jambThickness / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[doorWidth + jambThickness * 2, jambThickness, jambDepth]} />
        <meshPhysicalMaterial fog={false} {...wood} color="#94877a" bumpScale={0.015} roughness={0.85} clearcoat={0.25} />
      </mesh>
      <mesh position={[-jambThickness / 2, doorHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[jambThickness, doorHeight, jambDepth]} />
        <meshPhysicalMaterial fog={false} {...wood} color="#94877a" bumpScale={0.015} roughness={0.85} clearcoat={0.25} />
      </mesh>
      <mesh position={[doorWidth + jambThickness / 2, doorHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[jambThickness, doorHeight, jambDepth]} />
        <meshPhysicalMaterial fog={false} {...wood} color="#94877a" bumpScale={0.015} roughness={0.85} clearcoat={0.25} />
      </mesh>

      <mesh position={[doorWidth / 2, 0.02, 0]}>
        <boxGeometry args={[doorWidth, 0.03, 0.35]} />
        <meshPhysicalMaterial fog={false} color="#334155" roughness={0.4} metalness={0.2} />
      </mesh>

      <group ref={hingeRef} position={[0, 0, 0]} onPointerDown={toggleDoor}>
        <FixtureCollisionHighlight overlapping={overlapping}>
        <mesh position={[doorWidth / 2, doorHeight / 2, slabThickness / 2]} castShadow receiveShadow>
          <boxGeometry args={[doorWidth, doorHeight, slabThickness]} />
          <meshPhysicalMaterial fog={false} {...wood} color="#a99b88" bumpScale={0.012} roughness={0.8} clearcoat={0.3} />
        </mesh>

        {[1.4, 4.7].map((center, index) => (
          <group key={center} position={[doorWidth / 2, center, slabThickness + 0.025]}>
            <mesh receiveShadow castShadow>
              <boxGeometry args={[doorWidth - 0.48, index ? 3.8 : 1.65, 0.035]} />
              <meshPhysicalMaterial fog={false} {...wood} color="#867564" roughness={0.85} bumpScale={0.015} clearcoat={0.25} />
            </mesh>
            {[-1, 1].map(side => (
              <mesh key={side} position={[side * (doorWidth / 2 - 0.24), 0, 0.04]} castShadow>
                <boxGeometry args={[0.085, index ? 3.95 : 1.8, 0.06]} />
                <meshPhysicalMaterial fog={false} {...wood} roughness={0.85} clearcoat={0.25} />
              </mesh>
            ))}
            {[-1, 1].map(side => (
              <mesh key={side} position={[0, side * (index ? 1.93 : 0.86), 0.04]} castShadow>
                <boxGeometry args={[doorWidth - 0.4, 0.085, 0.06]} />
                <meshPhysicalMaterial fog={false} {...wood} roughness={0.85} clearcoat={0.25} />
              </mesh>
            ))}
          </group>
        ))}
        <group position={[doorWidth - 0.35, 3.2, slabThickness + 0.09]}>
          <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.035, 32]} />
            <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
          </mesh>
          <mesh position={[-0.16, 0, 0.06]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.025, 0.025, 0.42, 16]} />
            <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
          </mesh>
        </group>
        </FixtureCollisionHighlight>
      </group>

      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} onUpdate={object => object.layers.set(1)}>
        <ringGeometry args={[doorWidth - 0.04, doorWidth, 32, 1, 0, Math.PI / 2]} />
        <meshBasicMaterial fog={false} color="#38bdf8" transparent opacity={0.12} depthWrite={false} />
      </mesh>

      <StudioHtml position={[doorWidth / 2, doorHeight + 0.5, 0]} center distanceFactor={16}>
        <button
          type="button"
          aria-label={open ? 'Close entry door' : 'Open entry door'}
          aria-pressed={open}
          disabled={disabled}
          onPointerDown={event => event.stopPropagation()}
          onClick={toggleDoor}
          title="Click the door or this badge to open or close it"
          style={{
            background: overlapping ? 'rgba(69, 10, 10, 0.94)' : 'rgba(15, 23, 42, 0.94)',
            border: overlapping ? '1px solid #ef4444' : '1px solid rgba(56, 189, 248, 0.4)',
            color: overlapping ? '#fecaca' : '#38bdf8',
            padding: '2px 8px',
            borderRadius: '20px',
            fontSize: '10px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            fontFamily: 'Inter, Arial, sans-serif',
            letterSpacing: '0.06em',
            pointerEvents: 'auto',
            cursor: disabled ? 'default' : 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
          }}
        >
          ENTRY DOOR (32") · {overlapping ? 'COLLISION' : open ? 'OPEN' : 'CLOSED'}
        </button>
      </StudioHtml>
    </group>
  );
}

function Bathtub({ dimensions, rotation = 0, finish, isSelected, hasConflict, hideOverlays }) {
  const finishMat = FINISH_PRESETS[finish] || FINISH_PRESETS.brass;
  const porcelainColor = finish === 'matteBlack' ? '#181b22' : '#ffffff';

  return (
    <group rotation={[0, (rotation * Math.PI) / 180, 0]}>
      <InteractiveClearanceZone
        width={dimensions.width + 1.516}
        depth={dimensions.depth + 1.02}
        codeLabel="NKBA Guideline 12"
        ruleText='Min. 21" Egress Clearance to Adjacent Wall'
        isSelected={isSelected}
        hasConflict={hasConflict}
        hideZone={hideOverlays}
      />

      <group scale={dimensions.scale}>
      <CeramicBowl scale={[1.8, 1, 1]} color={porcelainColor} hasConflict={hasConflict} isSelected={isSelected} />
      <mesh position={[0.8, 0.265, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.012, 48]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} />
      </mesh>

      <group position={[0, 0, -1.25]}>
        <mesh position={[0, 1.4, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 2.8, 16]} />
          <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
        </mesh>
        <mesh position={[0, 2.75, 0.3]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.6, 16]} />
          <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
        </mesh>
        <mesh position={[0, 2.65, 0.58]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.2, 16]} />
          <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
        </mesh>
        <mesh position={[0.15, 2.5, 0]} rotation={[0, 0, -Math.PI / 3]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.35, 16]} />
          <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
        </mesh>
      </group>

      </group>
      <FixtureBadge text={`FREESTANDING TUB (${rotation}°)`} isSelected={isSelected} hasConflict={hasConflict} position={[0, 2.3, 0]} hideBadge={hideOverlays} />
    </group>
  );
}

function Vanity({ dimensions, rotation = 0, finish, isSelected, hasConflict, mirrorLightColor, mirrorIntensity, hideOverlays }) {
  const wood = useSurfaceMaps('walnut', 1, 1);
  const finishMat = FINISH_PRESETS[finish] || FINISH_PRESETS.brass;

  return (
    <group rotation={[0, (rotation * Math.PI) / 180, 0]}>
      <InteractiveClearanceZone
        width={dimensions.width + 0.3}
        depth={dimensions.depth + 0.9}
        codeLabel="NKBA Guideline 6"
        ruleText='21" Walkway in Front of Lavatory Basin'
        isSelected={isSelected}
        hasConflict={hasConflict}
        hideZone={hideOverlays}
      />

      <group position={[0, 0.65, 0]} scale={dimensions.scale}>
      <mesh position={[0, 1.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.4, 1.3, 2.0]} />
        <meshPhysicalMaterial fog={false} {...wood} bumpScale={0.018} roughness={0.85} clearcoat={0.35} clearcoatRoughness={0.25} />
      </mesh>

      {[0.78, 1.42].map(y => (
        <RoundedBox key={y} position={[0, y, 1.02]} args={[3.32, 0.6, 0.08]} radius={0.025} smoothness={4} castShadow receiveShadow>
          <meshPhysicalMaterial fog={false} {...wood} bumpScale={0.015} roughness={0.8} clearcoat={0.35} />
        </RoundedBox>
      ))}

      <mesh position={[0, 1.3, 1.14]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.7, 16]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
      </mesh>
      <mesh position={[0, 0.8, 1.14]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.7, 16]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
      </mesh>

      <mesh position={[0, 1.78, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.5, 0.12, 2.1]} />
        <meshPhysicalMaterial fog={false} color="#f8fafc" roughness={0.1} clearcoat={0.9} />
      </mesh>

      <CeramicBowl basin position={[0, 1.84, 0.1]} />

      <group position={[0, 2.05, -0.6]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.55, 16]} />
          <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
        </mesh>
        <mesh position={[0, 0.3, 0.2]} rotation={[Math.PI / 3, 0, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.45, 16]} />
          <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
        </mesh>
      </group>

      <RoundedBox position={[0, 4, -1.01]} args={[2.3, 3.3, 0.08]} radius={0.03} smoothness={4}>
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} />
      </RoundedBox>
      {/* Reuse the studio environment instead of six additional scene renders. */}
      <mesh position={[0, 4, -0.94]}>
        <boxGeometry args={[2.2, 3.2, 0.025]} />
        <meshPhysicalMaterial fog={false} color="#e7edf2" roughness={0.06} metalness={1} envMapIntensity={0.8} />
      </mesh>

      <pointLight position={[0, 4.0, -0.6]} intensity={mirrorIntensity} distance={4.5} color={mirrorLightColor} />
      </group>
      <FixtureBadge text={`VANITY SUITE (${rotation}°)`} isSelected={isSelected} hasConflict={hasConflict} position={[0, 4.4, 0]} hideBadge={hideOverlays} />
    </group>
  );
}

function SmartToilet({ dimensions, rotation = 0, finish, isSelected, hasConflict, hideOverlays }) {
  const finishMat = FINISH_PRESETS[finish] || FINISH_PRESETS.brass;
  const ceramicColor = finish === 'matteBlack' ? '#181b22' : '#ffffff';

  return (
    <group rotation={[0, (rotation * Math.PI) / 180, 0]}>
      <InteractiveClearanceZone
        width={dimensions.width + 1.7}
        depth={dimensions.depth + 1.49}
        codeLabel="NKBA Guideline 7 / ADA 604.2"
        ruleText='15" Centerline to Wall • 21" Front Walkway'
        isSelected={isSelected}
        hasConflict={hasConflict}
        hideZone={hideOverlays}
      />

      <group scale={dimensions.scale}>
      <RoundedBox position={[0, 0.65, 0]} args={[1.3, 1.2, 1.8]} radius={0.18} smoothness={6} castShadow receiveShadow>
        <meshPhysicalMaterial fog={false} color={ceramicColor} roughness={0.12} clearcoat={0.9} />
      </RoundedBox>

      <mesh position={[0, 1.05, 0.35]} castShadow>
        <cylinderGeometry args={[0.62, 0.52, 0.45, 32]} />
        <meshPhysicalMaterial fog={false} color={ceramicColor} roughness={0.12} clearcoat={0.9} />
      </mesh>

      <mesh position={[0, 1.3, 0.32]} castShadow>
        <cylinderGeometry args={[0.64, 0.64, 0.05, 32]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
      </mesh>

      <mesh position={[0, 2.2, -0.92]} castShadow>
        <boxGeometry args={[0.8, 0.5, 0.04]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
      </mesh>

      </group>
      <FixtureBadge text={`SMART TOILET (${rotation}°)`} isSelected={isSelected} hasConflict={hasConflict} position={[0, 2.6, 0]} hideBadge={hideOverlays} />
    </group>
  );
}

function ShowerEnclosure({ dimensions, rotation = 0, finish, isSelected, hasConflict, hideOverlays, wallColor }) {
  const finishMat = FINISH_PRESETS[finish] || FINISH_PRESETS.brass;

  return (
    <group rotation={[0, (rotation * Math.PI) / 180, 0]}>
      <InteractiveClearanceZone
        width={dimensions.width + 0.6}
        depth={dimensions.depth + 0.6}
        codeLabel="NKBA Guideline 9"
        ruleText='36" × 36" Min. Interior Floor Area'
        isSelected={isSelected}
        hasConflict={hasConflict}
        hideZone={hideOverlays}
      />

      <group scale={dimensions.scale}>
      <mesh position={[0, 0.08, 0]} receiveShadow>
        <boxGeometry args={[3.8, 0.16, 3.8]} />
        <meshPhysicalMaterial fog={false} color={wallColor} roughness={0.24} clearcoat={0.7} />
      </mesh>

      <mesh position={[0, 0.17, -1.4]}>
        <boxGeometry args={[2.4, 0.02, 0.2]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
      </mesh>

      <mesh position={[-1.85, 3.6, 0]} onUpdate={object => object.layers.set(1)}>
        <boxGeometry args={[0.1, 7.0, 3.8]} />
        <meshPhysicalMaterial fog={false}
          color="#ffffff"
          transmission={1}
          opacity={1}
          transparent
          roughness={0.05}
          ior={1.5}
          thickness={0.1}
          attenuationColor="#b8d4c5"
          attenuationDistance={3}
          depthWrite={false}
          specularIntensity={1.0}
        />
      </mesh>

      <mesh position={[0, 3.6, 1.85]} onUpdate={object => object.layers.set(1)}>
        <boxGeometry args={[3.8, 7.0, 0.1]} />
        <meshPhysicalMaterial fog={false} color="#ffffff" transmission={1} ior={1.5} thickness={0.1}
          roughness={0.05} transparent opacity={1} attenuationColor="#c2ddd2" attenuationDistance={3} depthWrite={false} />
      </mesh>
      <mesh position={[0, 7.1, 1.85]} castShadow>
        <boxGeometry args={[3.8, 0.065, 0.065]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} />
      </mesh>
      <mesh position={[1.15, 3.5, 1.94]} castShadow>
        <cylinderGeometry args={[0.025, 0.025, 0.65, 16]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} />
      </mesh>

      <mesh position={[-1.85, 7.1, 0]} castShadow>
        <boxGeometry args={[0.08, 0.08, 3.8]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
      </mesh>

      {[-1.87, 1.87].map(z => (
        <mesh key={z} position={[-1.85, 3.6, z]}>
          <boxGeometry args={[0.025, 7, 0.025]} />
          <meshPhysicalMaterial fog={false} color="#8bafa0" metalness={0.15} roughness={0.15} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
      <mesh position={[-1.85, 0.2, 0]}>
        <boxGeometry args={[0.07, 0.055, 3.8]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} />
      </mesh>
      <mesh position={[0, 3.5, -1.73]} castShadow>
        <boxGeometry args={[0.3, 0.55, 0.07]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} />
      </mesh>

      <mesh position={[0, 4.8, -1.75]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 3.4, 16]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
      </mesh>

      <mesh position={[0, 6.5, -0.9]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 1.7, 16]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
      </mesh>

      <mesh position={[0, 6.45, 0]} scale={dimensions.headScale} castShadow>
        <cylinderGeometry args={[0.7, 0.7, 0.08, 32]} />
        <meshPhysicalMaterial fog={false} color={finishMat.color} metalness={finishMat.metalness} roughness={finishMat.roughness} envMapIntensity={1.2} />
      </mesh>

      </group>
      <FixtureBadge text={`RAIN SHOWER (${rotation}°)`} isSelected={isSelected} hasConflict={hasConflict} position={[0, 7.3, 0]} hideBadge={hideOverlays} />
    </group>
  );
}

function RoomShell({ width, depth, wallColor, plan, walkthrough }) {
  const w = Number(width);
  const d = Number(depth);
  const h = 8.5;
  const doorW = 2.8;
  const doorH = 7.0;
  const doorZOffset = d * 0.15;
  const wallThickness = 0.24;

  const floorMaps = useSurfaceMaps('tile', w / 2, d / 2, wallColor);
  const plaster = useSurfaceMaps('plaster', 2, 2);

  const leftWallSegmentBackLength = Math.max(0.5, d / 2 + doorZOffset);
  const leftWallSegmentFrontLength = Math.max(0, d / 2 - (doorZOffset + doorW));

  return (
    <group>
      <mesh position={[0, -0.04, 0]} receiveShadow>
        <boxGeometry args={[w, 0.08, d]} />
        <meshPhysicalMaterial fog={false}
          {...floorMaps}
          bumpScale={0.018}
          roughness={0.38}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.09}
        />
      </mesh>

      <CutawayWall axis="z" boundary={-d / 2} plan={plan}>
      <mesh position={[-wallThickness / 2, h / 2, -d / 2 - wallThickness / 2]} castShadow receiveShadow>
        <boxGeometry args={[w + wallThickness, h, wallThickness]} />
        <meshPhysicalMaterial fog={false} {...plaster} color={wallColor} bumpScale={0.025} roughness={1} />
      </mesh>

      </CutawayWall>
      <CutawayWall axis="x" boundary={-w / 2} plan={plan}>
      <mesh
        position={[-w / 2 - wallThickness / 2, h / 2, -d / 2 + leftWallSegmentBackLength / 2]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow receiveShadow
      >
        <boxGeometry args={[leftWallSegmentBackLength, h, wallThickness]} />
        <meshPhysicalMaterial fog={false} {...plaster} color={wallColor} bumpScale={0.025} roughness={1} />
      </mesh>

      <mesh
        position={[-w / 2 - wallThickness / 2, doorH + (h - doorH) / 2, doorZOffset + doorW / 2]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow receiveShadow
      >
        <boxGeometry args={[doorW, h - doorH, wallThickness]} />
        <meshPhysicalMaterial fog={false} {...plaster} color={wallColor} bumpScale={0.025} roughness={1} />
      </mesh>

      {leftWallSegmentFrontLength > 0.1 && (
        <mesh
          position={[-w / 2 - wallThickness / 2, h / 2, d / 2 - leftWallSegmentFrontLength / 2]}
          rotation={[0, Math.PI / 2, 0]}
          castShadow receiveShadow
        >
          <boxGeometry args={[leftWallSegmentFrontLength, h, wallThickness]} />
          <meshPhysicalMaterial fog={false} {...plaster} color={wallColor} bumpScale={0.025} roughness={1} />
        </mesh>
      )}

      </CutawayWall>
      <mesh position={[0, -0.12, 0]} receiveShadow castShadow>
        <boxGeometry args={[w, 0.12, d]} />
        <meshPhysicalMaterial fog={false} color={wallColor} roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.12, -d / 2 + 0.12]}>
        <boxGeometry args={[w, 0.24, 0.05]} />
        <meshPhysicalMaterial fog={false} {...plaster} color={wallColor} roughness={0.9} />
      </mesh>
      {walkthrough && <group>
        <mesh position={[w / 2 + wallThickness / 2, h / 2, 0]} receiveShadow>
          <boxGeometry args={[wallThickness, h, d + wallThickness * 2]} />
          <meshPhysicalMaterial fog={false} {...plaster} color={wallColor} bumpScale={0.025} roughness={1} />
        </mesh>
        <mesh position={[0, h / 2, d / 2 + wallThickness / 2]} receiveShadow>
          <boxGeometry args={[w + wallThickness * 2, h, wallThickness]} />
          <meshPhysicalMaterial fog={false} {...plaster} color={wallColor} bumpScale={0.025} roughness={1} />
        </mesh>
        <mesh position={[0, h + wallThickness / 2, 0]} receiveShadow>
          <boxGeometry args={[w + wallThickness * 2, wallThickness, d + wallThickness * 2]} />
          <meshPhysicalMaterial fog={false} color={wallColor} roughness={0.9} />
        </mesh>
      </group>}
    </group>
  );
}

export default function Bathroom3D({ width = 16, depth = 14, products = EMPTY_PRODUCTS, comparisonContext = {}, restoreRequest, onRestoreLayout }) {
  const containerRef = useRef(null);
  const portalContainerRef = useRef(null);
  const controlsRef = useRef(null);
  const expandedStageRef = useRef(null);
  const [studioHost] = useState(() => {
    const host = document.createElement('div');
    Object.assign(host.style, { width: '100%', height: '100%', position: 'relative' });
    return host;
  });
  const [studioVersion, setStudioVersion] = useState(0);
  const [studioReady, setStudioReady] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const retryStudio = useCallback(() => {
    setStudioReady(false); setContextLost(false); setStudioVersion(version => version + 1);
  }, []);

  const [activeFinish, setActiveFinish] = useState('brass');
  const [activeWallColor, setActiveWallColor] = useState('chalkWhite');
  const [activeCategory, setActiveCategory] = useState('bathtub');
  const [lightingPreset, setLightingPreset] = useState('warmEvening');
  const [cameraView, setCameraView] = useState('orbit');
  const [isVRMode, setIsVRMode] = useState(false);
  const [activeDraggingFixture, setActiveDraggingFixture] = useState(null);
  const collisionFixtures = useRef(new Map());
  const [overlaps, setOverlaps] = useState({});
  const registerFixture = useCallback((id, fixture) => {
    if (fixture) collisionFixtures.current.set(id, fixture);
    else collisionFixtures.current.delete(id);
  }, []);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [doorOpen, setDoorOpen] = useState(false);
  const toggleDoor = useCallback(() => setDoorOpen(open => !open), []);
  const { visible: studioVisible, scrolling: pageScrolling } = useStudioActivity(studioHost, isExpanded);

  // Reparent the same host instead of unmounting the Canvas on expansion.
  useLayoutEffect(() => {
    const target = isExpanded ? expandedStageRef.current : containerRef.current;
    target?.appendChild(studioHost);
    return () => studioHost.remove();
  }, [isExpanded, studioHost]);


  const isWalkthrough = isVRMode || cameraView === 'eye';
  const fixtureDimensions = useMemo(() => ({
    bathtub: resolveProductDimensions('bathtub', products.bathtubs ?? products.bathtub),
    vanity: resolveProductDimensions('vanity', products.vanities ?? products.vanity),
    shower: resolveProductDimensions('shower', products.showers ?? products.shower),
    toilet: resolveProductDimensions('toilet', products.toilets ?? products.toilet)
  }), [products]);

  const w = Math.max(Number(width) || 16, 8);
  const d = Math.max(Number(depth) || 14, 8);

  const [rotations, setRotations] = useState({
    toilet: 0,
    vanity: 0,
    shower: 0,
    bathtub: 0
  });

  const [positions, setPositions] = useState({
    vanity: [-4.8, 0, -4.2],
    shower: [4.8, 0, -4.2],
    toilet: [-5.0, 0, 3.8],
    bathtub: [3.8, 0, 3.5]
  });

  const [appliedRestore, setAppliedRestore] = useState(null);
  if (restoreRequest && restoreRequest !== appliedRestore) {
    // Adjust local state once for a new explicit load request, before rendering
    // the scene. Ordinary parent updates never overwrite subsequent edits.
    setAppliedRestore(restoreRequest);
    setPositions(Object.fromEntries(Object.entries(restoreRequest.positions).map(([id, position]) => [id, [...position]])));
    setRotations({ ...restoreRequest.rotations });
    setActiveFinish(savedPreset(restoreRequest.finishKey || restoreRequest.finish, FINISH_PRESETS, 'brass'));
    setActiveWallColor(savedPreset(restoreRequest.wallKey || restoreRequest.wall, WALL_PAINT_PRESETS, 'chalkWhite'));
    setLightingPreset(savedPreset(restoreRequest.lighting, LIGHTING_MODES, 'warmEvening'));
    setDoorOpen(Boolean(restoreRequest.doorOpen));
    setCameraView(['orbit', 'top', 'eye'].includes(restoreRequest.cameraView) ? restoreRequest.cameraView : 'orbit');
    setIsVRMode(Boolean(restoreRequest.isVRMode));
    setActiveCategory(['bathtub', 'vanity', 'shower', 'toilet'].includes(restoreRequest.activeCategory) ? restoreRequest.activeCategory : 'bathtub');
  }

  const boundedPositions = useMemo(() => Object.fromEntries(Object.entries(positions).map(([id, position]) => {
    const bounds = rotatedFootprint(fixtureDimensions[id], rotations[id]);
    const maxX = Math.max(0, (w - bounds.width) / 2 - 0.06);
    const maxZ = Math.max(0, (d - bounds.depth) / 2 - 0.06);
    return [id, [THREE.MathUtils.clamp(position[0], -maxX, maxX), 0, THREE.MathUtils.clamp(position[2], -maxZ, maxZ)]];
  })), [positions, fixtureDimensions, rotations, w, d]);

  const conflicts = useMemo(() => {
    const list = Object.entries(boundedPositions);
    const flags = { bathtub: false, vanity: false, shower: false, toilet: false };


    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [catA, posA] = list[i];
        const [catB, posB] = list[j];
        const a = rotatedFootprint(fixtureDimensions[catA], rotations[catA]);
        const b = rotatedFootprint(fixtureDimensions[catB], rotations[catB]);
        if (Math.abs(posA[0] - posB[0]) < (a.width + b.width) / 2 + 0.25
          && Math.abs(posA[2] - posB[2]) < (a.depth + b.depth) / 2 + 0.25) {
          flags[catA] = true;
          flags[catB] = true;
        }
      }
    }
    return flags;
  }, [boundedPositions, fixtureDimensions, rotations]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [isExpanded]);

  useEffect(() => {
    const el = portalContainerRef.current;
    if (!el) return;
    const handleWheel = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [isExpanded]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (isExpanded) setIsExpanded(false);
        if (isVRMode) setIsVRMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded, isVRMode]);

  const rotateFixture = (category) => {
    setRotations((prev) => ({
      ...prev,
      [category]: (prev[category] + 90) % 360
    }));
  };

  const handleDragStart = useCallback(id => {
    setActiveCategory(id);
    setActiveDraggingFixture(id);
  }, []);

  const handleDragCommit = useCallback((id, position) => {
    setPositions(previous => ({ ...previous, [id]: position }));
    setActiveDraggingFixture(null);
  }, []);

  const handleExportVRVideo = () => {
    const targetRef = isExpanded ? portalContainerRef.current : containerRef.current;
    const canvas = targetRef?.querySelector('canvas');
    if (!canvas) {
      alert("3D Canvas element not found for recording.");
      return;
    }

    setIsVRMode(false);
    setIsRecordingVideo(true);
    setCameraView('orbit');

    const stream = canvas.captureStream(60);
    let recordedChunks = [];

    let options = { 
      mimeType: 'video/webm; codecs=vp9',
      videoBitsPerSecond: 6000000 
    };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/webm', videoBitsPerSecond: 6000000 };
    }

    const mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const videoUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = videoUrl;
      downloadLink.download = 'kohler-smooth-human-tour.webm';
      downloadLink.click();
      setIsRecordingVideo(false);
    };

    mediaRecorder.start(50);

    setTimeout(() => {
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    }, 20000);
  };

  const lightConfig = LIGHTING_MODES[lightingPreset] || LIGHTING_MODES.warmEvening;
  const wallConfig = WALL_PAINT_PRESETS[activeWallColor] || WALL_PAINT_PRESETS.chalkWhite;

  const renderStudioCanvas = () => (
    <>
      <div
        style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          right: '10px',
          zIndex: 30,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pointerEvents: 'none',
          gap: '6px'
        }}
      >
        <div style={{ background: 'rgba(7, 7, 7, 0.92)', padding: '3px 8px', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="font-mono" style={{ display: 'block', color: 'var(--accent-gold, #c5a059)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>
            {isExpanded ? 'FULL THEATER PROJECTION' : 'SPATIAL STUDIO'} [{w}' &times; {d}'] {isWalkthrough ? '🎮 WASD · CLICK OR RIGHT-DRAG TO LOOK · HOLD LEFT TO GRAB · RELEASE TO DROP' : isRecordingVideo ? '🔴 RECORDING TOUR...' : ''}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '4px', pointerEvents: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={toggleDoor}
            aria-pressed={doorOpen}
            disabled={isRecordingVideo}
            title="Open or close the entry door"
            className="clickable font-mono"
            style={{ background: 'rgba(7, 7, 7, 0.92)', border: '1px solid #38bdf8', color: '#7dd3fc', padding: '3px 9px', fontSize: '0.62rem', borderRadius: '4px', cursor: isRecordingVideo ? 'default' : 'pointer' }}
          >
            {doorOpen ? 'Close Door' : 'Open Door'}
          </button>
          <button
            type="button"
            onClick={() => setIsVRMode(!isVRMode)}
            className="clickable font-mono"
            style={{
              background: isVRMode ? '#10b981' : 'rgba(197, 160, 89, 0.2)',
              border: isVRMode ? '1px solid #10b981' : '1px solid #c5a059',
              color: isVRMode ? '#070707' : '#f5f5f5',
              padding: '3px 10px',
              fontSize: '0.62rem',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            {isVRMode ? '🛑 Exit VR Mode' : '🥽 Demo (VR Walkthrough)'}
          </button>

          <button
            type="button"
            onClick={handleExportVRVideo}
            disabled={isRecordingVideo}
            className="clickable font-mono"
            style={{
              background: isRecordingVideo ? '#ef4444' : '#c5a059',
              border: 'none',
              color: isRecordingVideo ? '#ffffff' : '#070707',
              padding: '3px 9px',
              fontSize: '0.62rem',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            {isRecordingVideo ? '🎥 Recording Tour...' : '🎥 Export 20s VR Video'}
          </button>

          {Object.entries(LIGHTING_MODES).map(([modeKey]) => {
            const isCurrent = lightingPreset === modeKey;
            return (
              <button
                key={modeKey}
                type="button"
                onClick={() => setLightingPreset(modeKey)}
                className="clickable font-mono"
                style={{
                  background: isCurrent ? 'rgba(197, 160, 89, 0.3)' : 'rgba(7, 7, 7, 0.92)',
                  border: isCurrent ? '1px solid #c5a059' : '1px solid rgba(255,255,255,0.1)',
                  color: isCurrent ? '#f8fafc' : '#888888',
                  padding: '3px 6px',
                  fontSize: '0.62rem',
                  cursor: 'pointer'
                }}
              >
                {modeKey === 'daylight' ? '☀️' : modeKey === 'warmEvening' ? '💡' : '🌙'}
              </button>
            );
          })}

          {!isVRMode && (
            <div style={{ display: 'flex', background: 'rgba(7, 7, 7, 0.92)', border: '1px solid rgba(255,255,255,0.1)' }}>
              {[
                { id: 'orbit', label: '3D' },
                { id: 'top', label: 'Plan' },
                { id: 'eye', label: 'Eye' }
              ].map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setCameraView(view.id)}
                  className="clickable font-mono"
                  style={{
                    background: cameraView === view.id ? 'var(--accent-gold, #c5a059)' : 'transparent',
                    border: 'none',
                    color: cameraView === view.id ? '#070707' : '#888888',
                    padding: '3px 7px',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {view.label}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="clickable font-mono"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: isExpanded ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.08)',
              border: isExpanded ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.2)',
              color: isExpanded ? '#fca5a5' : '#ffffff',
              padding: '3px 8px',
              fontSize: '0.62rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              cursor: 'pointer'
            }}
          >
            {isExpanded ? '⤢ Exit' : '⤡ Expand'}
          </button>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 30,
          background: 'rgba(9, 9, 9, 0.96)',
          border: '1px solid rgba(197, 160, 89, 0.4)',
          borderRadius: '20px',
          padding: '4px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.8)',
          maxWidth: '96%',
          flexWrap: 'wrap',
          justifyContent: 'center'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', borderRight: '1px solid rgba(255,255,255,0.12)', paddingRight: '6px' }}>
          <span className="font-mono" style={{ color: '#888888', fontSize: '0.58rem', textTransform: 'uppercase' }}>
            Orient:
          </span>
          {[
            { id: 'bathtub', label: 'Tub' },
            { id: 'toilet', label: 'Toilet' },
            { id: 'vanity', label: 'Vanity' },
            { id: 'shower', label: 'Shower' }
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveCategory(item.id);
                rotateFixture(item.id);
              }}
              className="clickable font-mono"
              style={{
                background: conflicts[item.id]
                  ? 'rgba(239, 68, 68, 0.3)'
                  : activeCategory === item.id
                  ? 'rgba(197, 160, 89, 0.25)'
                  : 'transparent',
                border: conflicts[item.id]
                  ? '1px solid #ef4444'
                  : activeCategory === item.id
                  ? '1px solid #c5a059'
                  : '1px solid rgba(255, 255, 255, 0.1)',
                color: conflicts[item.id] ? '#fca5a5' : activeCategory === item.id ? '#c5a059' : '#a3a3a3',
                borderRadius: '10px',
                padding: '2px 6px',
                fontSize: '0.58rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '2px'
              }}
            >
              {conflicts[item.id] ? '⚠️' : '↻'} {item.label} ({rotations[item.id]}°)
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', borderRight: '1px solid rgba(255,255,255,0.12)', paddingRight: '6px' }}>
          <span className="font-mono" style={{ color: '#888888', fontSize: '0.58rem', textTransform: 'uppercase' }}>
            Wall:
          </span>
          {Object.entries(WALL_PAINT_PRESETS).map(([key, item]) => {
            const isActive = activeWallColor === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveWallColor(key)}
                title={item.label}
                className="clickable font-mono"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  border: isActive ? '1px solid #c5a059' : '1px solid rgba(255, 255, 255, 0.08)',
                  background: isActive ? 'rgba(197, 160, 89, 0.18)' : 'transparent',
                  color: isActive ? '#f5f5f5' : '#888888',
                  cursor: 'pointer',
                  fontSize: '0.58rem',
                  fontWeight: isActive ? 700 : 500
                }}
              >
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: item.swatch,
                    border: '1px solid rgba(255, 255, 255, 0.3)'
                  }}
                />
                {item.label.split(' ')[0]}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span className="font-mono" style={{ color: '#888888', fontSize: '0.58rem', textTransform: 'uppercase' }}>
            Finish:
          </span>
          {Object.entries(FINISH_PRESETS).map(([key, item]) => {
            const isActive = activeFinish === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveFinish(key)}
                title={item.label}
                className="clickable font-mono"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  border: isActive ? '1px solid #c5a059' : '1px solid rgba(255, 255, 255, 0.08)',
                  background: isActive ? 'rgba(197, 160, 89, 0.18)' : 'transparent',
                  color: isActive ? '#f5f5f5' : '#888888',
                  cursor: 'pointer',
                  fontSize: '0.58rem',
                  fontWeight: isActive ? 700 : 500
                }}
              >
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: item.swatch,
                    border: '1px solid rgba(255, 255, 255, 0.3)'
                  }}
                />
                {item.label.split(' ')[0]}
              </button>
            );
          })}
        </div>
      </div>

      {isWalkthrough && (
        <div aria-hidden="true" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 25, pointerEvents: 'none', color: '#ffffff', textShadow: '0 1px 4px #000', fontSize: '22px', lineHeight: 1 }}>+</div>
      )}

      <StudioBoundary key={studioVersion} onRetry={retryStudio}>
      <Canvas
        data-render-mode={!studioVisible ? 'paused' : pageScrolling ? 'scrolling' : 'active'}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        fallback={<div role="alert" style={{ padding: 32, color: '#e2e8f0' }}>WebGL is unavailable. Enable graphics acceleration in your browser to view the studio.</div>}
        shadows={THREE.PCFSoftShadowMap}
        dpr={isWalkthrough ? 1 : [1, 1.25]}
        frameloop={isRecordingVideo ? 'always' : studioVisible ? 'demand' : 'never'}
        gl={{
          antialias: false,
          stencil: false,
          alpha: false,
          preserveDrawingBuffer: false,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          outputColorSpace: THREE.SRGBColorSpace
        }}
        camera={{ position: [16, 9.5, 18], fov: 40, near: 0.1, far: 100 }}
      >
        <StudioHealth onReady={setStudioReady} onContextLost={setContextLost} onContextRestored={retryStudio} />
        <SceneBackground />
        {cameraView === 'top' && !isWalkthrough && <PlanCamera width={w} depth={d} />}
        {!isWalkthrough && <CameraController cameraView={cameraView} width={w} depth={d} />}
        <VRWalkthroughController enabled={isWalkthrough} startAtEntry={isVRMode} paused={isRecordingVideo} width={w} depth={d} />
        <RenderBudget fixtures={collisionFixtures} walkthrough={isWalkthrough} dragging={Boolean(activeDraggingFixture)} revision={`${w},${d},${lightingPreset},${JSON.stringify(positions)},${JSON.stringify(rotations)},${JSON.stringify(fixtureDimensions)}`} />
        <StudioResolution walkthrough={isWalkthrough} expanded={isExpanded} />
        <StudioAntialiasing />
        <StudioMaterialBudget />
        <CinematicCameraAnimator 
          isRecording={isRecordingVideo} 
          width={w} 
          depth={d} 
          onComplete={() => setIsRecordingVideo(false)}
        />

        <ambientLight color={lightConfig.ambientColor} intensity={lightConfig.ambientIntensity * 0.5} />
        <RoomEnvironment night={lightingPreset === 'spaNight'} />

        <directionalLight
          position={lightConfig.sunPos}
          color={lightConfig.sunColor}
          intensity={lightConfig.sunIntensity}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-Math.max(w, d)}
          shadow-camera-right={Math.max(w, d)}
          shadow-camera-top={Math.max(w, d)}
          shadow-camera-bottom={-Math.max(w, d)}
          shadow-camera-near={0.5}
          shadow-camera-far={60}
          shadow-bias={-0.00015}
          shadow-normalBias={0.035}
          shadow-radius={4}
          shadow-blurSamples={8}
        />

        <hemisphereLight args={['#fff4e4', '#8f8070', 0.5]} />
        <rectAreaLight position={[0, 9, 3]} rotation={[-Math.PI / 2, 0, 0]} width={8} height={6} intensity={lightingPreset === 'spaNight' ? 0.5 : 1.5} color="#fff3df" />

        {/* Large Studio Backplate to eliminate empty void */}
        <StudioBackdrop lighting={lightingPreset} />

        <RoomShell
          width={w}
          depth={d}
          wallColor={wallConfig.color}
          plan={cameraView === 'top' && !isWalkthrough}
          walkthrough={isWalkthrough}
        />

        <EntryDoor
          position={[-w / 2 + 0.04, 0, d * 0.15 + 2.8]}
          rotation={90}
          finish={activeFinish}
          doorWidth={2.8}
          doorHeight={7.0}
          open={doorOpen}
          onToggle={toggleDoor}
          disabled={isRecordingVideo}
          onRegister={registerFixture}
          overlapping={overlaps.door}
        />

        <DraggableFixture
          id="bathtub" width={w} depth={d} enabled={!isRecordingVideo} walkthrough={isWalkthrough} controlsRef={controlsRef}
          position={boundedPositions.bathtub} dimensions={fixtureDimensions.bathtub} rotation={rotations.bathtub}
          onStart={handleDragStart} onCommit={handleDragCommit} onRegister={registerFixture} overlapping={overlaps.bathtub}
        >
          <Bathtub
            dimensions={fixtureDimensions.bathtub}
            rotation={rotations.bathtub}
            finish={activeFinish}
            isSelected={activeCategory === 'bathtub'}
            hasConflict={conflicts.bathtub}
            hideOverlays={isWalkthrough}
          />
        </DraggableFixture>

        <DraggableFixture
          id="vanity" width={w} depth={d} enabled={!isRecordingVideo} walkthrough={isWalkthrough} controlsRef={controlsRef}
          position={boundedPositions.vanity} dimensions={fixtureDimensions.vanity} rotation={rotations.vanity}
          onStart={handleDragStart} onCommit={handleDragCommit} onRegister={registerFixture} overlapping={overlaps.vanity}
        >
          <Vanity
            dimensions={fixtureDimensions.vanity}
            rotation={rotations.vanity}
            finish={activeFinish}
            isSelected={activeCategory === 'vanity'}
            hasConflict={conflicts.vanity}
            mirrorLightColor={lightConfig.mirrorLightColor}
            mirrorIntensity={lightConfig.mirrorIntensity}
            hideOverlays={isWalkthrough}
            isDragging={Boolean(activeDraggingFixture)}
          />
        </DraggableFixture>

        <DraggableFixture
          id="shower" width={w} depth={d} enabled={!isRecordingVideo} walkthrough={isWalkthrough} controlsRef={controlsRef}
          position={boundedPositions.shower} dimensions={fixtureDimensions.shower} rotation={rotations.shower}
          onStart={handleDragStart} onCommit={handleDragCommit} onRegister={registerFixture} overlapping={overlaps.shower}
        >
          <ShowerEnclosure
            dimensions={fixtureDimensions.shower}
            rotation={rotations.shower}
            finish={activeFinish}
            isSelected={activeCategory === 'shower'}
            hasConflict={conflicts.shower}
            hideOverlays={isWalkthrough}
            wallColor={wallConfig.color}
          />
        </DraggableFixture>

        <DraggableFixture
          id="toilet" width={w} depth={d} enabled={!isRecordingVideo} walkthrough={isWalkthrough} controlsRef={controlsRef}
          position={boundedPositions.toilet} dimensions={fixtureDimensions.toilet} rotation={rotations.toilet}
          onStart={handleDragStart} onCommit={handleDragCommit} onRegister={registerFixture} overlapping={overlaps.toilet}
        >
          <SmartToilet
            dimensions={fixtureDimensions.toilet}
            rotation={rotations.toilet}
            finish={activeFinish}
            isSelected={activeCategory === 'toilet'}
            hasConflict={conflicts.toilet}
            hideOverlays={isWalkthrough}
          />
        </DraggableFixture>

        <FixtureCollisionMonitor fixtures={collisionFixtures} onChange={setOverlaps} />
        {/* The directional shadow stays live while dragging; bake contact shadows on release. */}
        {!activeDraggingFixture && <ContactShadows key={`${isWalkthrough},${w},${d},${JSON.stringify(boundedPositions)},${JSON.stringify(rotations)},${JSON.stringify(fixtureDimensions)}`} position={[0, 0.003, 0]} opacity={0.42} scale={Math.max(w, d) * 1.3} blur={2.4} far={3.5} resolution={512} color="#493a2b" frames={1} />}

        {isWalkthrough ? (
          <WalkthroughMouseLook />
        ) : (
          <OrbitControls
            ref={controlsRef}
            makeDefault
            key={cameraView}
            target={
              cameraView === 'top'
                ? [0, 0, 0]
                : cameraView === 'eye'
                ? [0, 2.5, 0]
                : [0, 3, 0]
            }
            autoRotate={studioVisible && !pageScrolling && !isRecordingVideo && !activeDraggingFixture}
            autoRotateSpeed={0.5}
            enableDamping={true}
            dampingFactor={0.08}
            enabled={!isRecordingVideo && !activeDraggingFixture}
            enablePan={!activeDraggingFixture}
            enableZoom={true}
            enableRotate={cameraView !== 'top'}
            minPolarAngle={cameraView === 'top' ? 0.001 : 0.05}
            maxPolarAngle={cameraView === 'top' ? 0.001 : Math.PI / 2 - 0.05}
            minDistance={cameraView === 'top' ? 2 : 4}
            maxDistance={Math.max(w, d) * 3.2}
          />
        )}
      </Canvas>
      </StudioBoundary>
      {Object.values(overlaps).some(Boolean) && <div role="status" data-fixture-overlap="true" style={{ position: 'absolute', left: '50%', top: '72px', transform: 'translateX(-50%)', zIndex: 31, padding: '6px 12px', borderRadius: '20px', border: '1px solid #ef4444', background: 'rgba(69,10,10,0.94)', color: '#fecaca', fontSize: '12px', pointerEvents: 'none', textAlign: 'center' }}>
        {overlaps.door ? 'Door collision — move the red product clear of the door.' : 'Products overlap — move the red fixtures apart.'}
      </div>}
      {(!studioReady || contextLost) && <div role="status" style={{ position: 'absolute', inset: 0, zIndex: 15, display: 'grid', placeContent: 'center', textAlign: 'center', color: '#e2e8f0', pointerEvents: contextLost ? 'auto' : 'none' }}>
        <span>{contextLost ? 'The graphics context was interrupted.' : 'Preparing your architectural studio…'}</span>
        {contextLost && <button type="button" onClick={retryStudio}>Restore 3D view</button>}
      </div>}
    </>
  );

  return (
    <>
      {createPortal(renderStudioCanvas(), studioHost)}
      <div
        ref={containerRef}
        data-lenis-prevent="true"
        style={{
          position: 'relative',
          width: '100%',
          height: '360px',
          overflow: 'hidden',
          border: '1px solid var(--hairline, rgba(255, 255, 255, 0.08))',
          background: 'radial-gradient(circle at center, #141c2a 0%, #0a0d14 100%)',
          userSelect: 'none',
          touchAction: 'none'
        }}
      >

      </div>

      <SavedLayoutComparison
        catalog={comparisonContext.catalog}
        disabled={Boolean(activeDraggingFixture) || isRecordingVideo || comparisonContext.busy}
        onLoad={onRestoreLayout}
        getSnapshot={() => ({
          width: w, depth: d, positions: boundedPositions, rotations,
          dimensions: fixtureDimensions,
          products: comparisonContext.products || {},
          price: Number.isFinite(Number(comparisonContext.price)) && comparisonContext.price !== null
            ? Number(comparisonContext.price) : null,
          tier: comparisonContext.title,
          budget: comparisonContext.budget, style: comparisonContext.style, ecoMode: comparisonContext.ecoMode,
          finishKey: activeFinish, wallKey: activeWallColor, doorOpen, cameraView, isVRMode, activeCategory,
          finish: FINISH_PRESETS[activeFinish]?.label,
          wall: WALL_PAINT_PRESETS[activeWallColor]?.label,
          lighting: lightingPreset
        })}
      />

      {isExpanded &&
        createPortal(
          <div
            ref={portalContainerRef}
            data-lenis-prevent="true"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 999999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'radial-gradient(circle at center, #141c2a 0%, #0a0d14 100%)',
              padding: '24px',
              boxSizing: 'border-box'
            }}
            onClick={() => setIsExpanded(false)}
          >
            <div
              ref={expandedStageRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: '1440px',
                height: '92vh',
                overflow: 'hidden',
                border: '1px solid var(--hairline-hover, rgba(255, 255, 255, 0.2))',
                background: 'radial-gradient(circle at center, #141c2a 0%, #0a0d14 100%)',
                boxShadow: '0 25px 90px rgba(0, 0, 0, 0.98)',
                userSelect: 'none',
                touchAction: 'none'
              }}
            >

            </div>
          </div>,
          document.body
        )}
    </>
  );
}

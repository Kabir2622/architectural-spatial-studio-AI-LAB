import { useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Scene, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PlaneGeometry,
  OrthographicCamera, WebGLRenderTarget, HalfFloatType } from 'three';
import { shadowReceiverGeometry } from './shadowReceiverGeometry';

// The matte studio ground does not move. Cache its physical lighting at 4K,
// rather than evaluating its environment and area-light BRDF over millions of
// backdrop pixels every frame. Live shadows remain a separate receiver.
export default function StudioBackdrop({ lighting }) {
  const { scene, gl, invalidate } = useThree();
  const ground = useRef(null);
  const receiver = useRef(null);
  const cache = useRef(null);
  useLayoutEffect(() => {
    const target = new WebGLRenderTarget(4096, 4096, { type: HalfFloatType, depthBuffer: false, stencilBuffer: false });
    const material = new MeshPhysicalMaterial({ color: '#101622', roughness: 0.85, metalness: 0.15, fog: false });
    const geometry = new PlaneGeometry(120, 120);
    const captureGround = new Mesh(geometry, material);
    captureGround.rotation.x = -Math.PI / 2;
    captureGround.position.y = -0.19;
    const capture = new Scene();
    capture.add(captureGround);
    const camera = new OrthographicCamera(-60, 60, 60, -60, 0.1, 200);
    camera.position.set(0, 100, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    const display = new MeshBasicMaterial({ map: target.texture, fog: true });
    const groundMesh = ground.current, original = groundMesh.material;
    const resources = { target, capture, camera, display, original, environment: null, lighting: null, shadowKey: null, receiverGeometry: null };
    cache.current = resources;
    return () => {
      groundMesh.material = original;
      resources.receiverGeometry?.dispose();
      cache.current = null;
      target.dispose(); material.dispose(); geometry.dispose(); display.dispose();
    };
  }, []);

  useFrame(() => {
    const value = cache.current;
    if (!value) return;
    let keyLight;
    scene.traverseVisible(object => { if (object.isDirectionalLight && object.castShadow) keyLight = object; });
    if (keyLight) {
      const camera = keyLight.shadow.camera;
      const key = `${keyLight.position.toArray()},${camera.left},${camera.right},${camera.top},${camera.bottom}`;
      if (value.shadowKey !== key) {
        keyLight.updateWorldMatrix(true, false);
        keyLight.target.updateWorldMatrix(true, false);
        keyLight.shadow.updateMatrices(keyLight);
        const geometry = shadowReceiverGeometry(camera, -0.189);
        if (geometry) {
          value.receiverGeometry?.dispose();
          receiver.current.geometry = geometry;
          value.receiverGeometry = geometry;
          value.shadowKey = key;
        }
      }
    }
    if (!scene.environment || (value.environment === scene.environment && value.lighting === lighting)) return;
    const lights = [];
    scene.traverseVisible(object => {
      if (!object.isLight) return;
      const clone = object.clone();
      object.updateWorldMatrix(true, false);
      clone.position.setFromMatrixPosition(object.matrixWorld);
      clone.castShadow = false;
      if (object.target) {
        object.target.updateWorldMatrix(true, false);
        clone.target.position.setFromMatrixPosition(object.target.matrixWorld);
        value.capture.add(clone.target);
        lights.push(clone.target);
      }
      value.capture.add(clone); lights.push(clone);
    });
    value.capture.environment = scene.environment;
    value.capture.environmentIntensity = scene.environmentIntensity;
    const target = gl.getRenderTarget(), autoClear = gl.autoClear;
    const shadowAutoUpdate = gl.shadowMap.autoUpdate, shadowUpdate = gl.shadowMap.needsUpdate;
    try {
      gl.autoClear = true;
      gl.shadowMap.autoUpdate = false;
      gl.shadowMap.needsUpdate = false;
      gl.setRenderTarget(value.target);
      gl.render(value.capture, value.camera);
      ground.current.material = value.display;
      value.environment = scene.environment;
      value.lighting = lighting;
    } finally {
      lights.forEach(light => value.capture.remove(light));
      gl.setRenderTarget(target);
      gl.autoClear = autoClear;
      gl.shadowMap.autoUpdate = shadowAutoUpdate;
      gl.shadowMap.needsUpdate = shadowUpdate;
    }
    invalidate();
  }, -1);

  return <group>
    <mesh ref={ground} position={[0, -0.19, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[120, 120]} />
      <meshPhysicalMaterial fog color="#101622" roughness={0.85} metalness={0.15} />
    </mesh>
    <mesh ref={receiver} receiveShadow>
      <planeGeometry args={[120, 120]} />
      <shadowMaterial color="#000000" opacity={0.3} depthWrite={false} />
    </mesh>
  </group>;
}

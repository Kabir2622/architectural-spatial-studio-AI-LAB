import { MeshDepthMaterial } from 'three';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

// Reject covered pixels before running the expensive architectural PBR shaders.
// This retains the original geometry, materials, lighting and display resolution.
export class StudioRenderPass extends RenderPass {
  constructor(scene, camera) {
    super(scene, camera);
    this.depthMaterial = new MeshDepthMaterial({ colorWrite: false });
  }

  render(renderer, writeBuffer, readBuffer) {
    const scene = this.scene;
    const previous = {
      background: scene.background, override: scene.overrideMaterial,
      autoClear: renderer.autoClear, shadowUpdate: renderer.shadowMap.needsUpdate,
      shadowAutoUpdate: renderer.shadowMap.autoUpdate
    };
    const excluded = [];
    // Glass, fading cutaway walls and overlays must never occlude the scene.
    scene.traverseVisible(object => {
      if (!object.isMesh && !object.isSprite && !object.isLine && !object.isPoints) return;
      const material = object.material;
      if (!object.isMesh || Array.isArray(material) || !material?.depthWrite
        || material.transparent || material.transmission > 0 || material.alphaTest > 0
        || material.side !== this.depthMaterial.side || material.polygonOffset) excluded.push(object);
    });
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.autoClear = false;
    renderer.clear(true, true, false);
    try {
      excluded.forEach(object => { object.visible = false; });
      scene.background = null;
      scene.overrideMaterial = this.depthMaterial;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.render(scene, this.camera);
    } finally {
      excluded.forEach(object => { object.visible = true; });
      scene.background = previous.background;
      scene.overrideMaterial = previous.override;
      renderer.shadowMap.autoUpdate = previous.shadowAutoUpdate;
      renderer.shadowMap.needsUpdate = previous.shadowUpdate;
      renderer.autoClear = previous.autoClear;
    }
    const clear = this.clear;
    const autoClearDepth = renderer.autoClearDepth;
    this.clear = false;
    renderer.autoClearDepth = false;
    try {
      super.render(renderer, writeBuffer, readBuffer);
    } finally {
      this.clear = clear;
      renderer.autoClearDepth = autoClearDepth;
    }
  }

  dispose() { this.depthMaterial.dispose(); }
}

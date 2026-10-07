import { useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { WebGLRenderTarget, RGBFormat, UnsignedInt101111Type, HalfFloatType } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { StudioRenderPass } from './StudioRenderPass';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { StudioOutputShader } from './studioOutputShader';

// Anti-alias at the locked display resolution without multisampling every
// expensive PBR fragment. Fuse ACES/sRGB output into the anti-aliasing pass.
export default function StudioAntialiasing() {
  const { gl, scene, camera, size, viewport, invalidate } = useThree();
  const pipeline = useRef(null);
  useLayoutEffect(() => {
    // The stage is opaque. Packed floating-point HDR retains highlights while
    // halving color-buffer traffic compared with an unused 16-bit alpha channel.
    const packedHDR = gl.extensions.has('EXT_color_buffer_float');
    const target = new WebGLRenderTarget(1, 1, packedHDR
      ? { format: RGBFormat, type: UnsignedInt101111Type, depthBuffer: true, stencilBuffer: false }
      : { type: HalfFloatType, depthBuffer: true, stencilBuffer: false });
    const composer = new EffectComposer(gl, target);
    const render = new StudioRenderPass(scene, camera);
    const antialias = new ShaderPass(StudioOutputShader);
    antialias.material.toneMapped = false;
    composer.addPass(render);
    composer.addPass(antialias);
    pipeline.current = { composer, antialias };
    invalidate();
    return () => {
      pipeline.current = null;
      render.dispose(); antialias.dispose(); composer.dispose();
    };
  }, [gl, scene, camera, invalidate]);
  useLayoutEffect(() => {
    const value = pipeline.current;
    if (!value) return;
    value.composer.setPixelRatio(viewport.dpr);
    value.composer.setSize(size.width, size.height);
    value.antialias.material.uniforms.resolution.value.set(
      1 / Math.max(1, size.width * viewport.dpr), 1 / Math.max(1, size.height * viewport.dpr)
    );
    invalidate();
  }, [camera, size.width, size.height, viewport.dpr, invalidate]);
  useFrame((state, delta) => {
    if (pipeline.current) {
      pipeline.current.antialias.material.uniforms.toneMappingExposure.value = state.gl.toneMappingExposure;
      pipeline.current.composer.render(delta);
    }
    else state.gl.render(state.scene, state.camera);
  }, 1);
  return null;
}

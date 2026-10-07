import { useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { studioPixelRatio, glassRenderScale } from './renderQuality';

export default function StudioResolution({ walkthrough, expanded }) {
  const { size, gl, setDpr, invalidate } = useThree();
  const renderer = useRef(gl);
  const ratio = studioPixelRatio(size.width, size.height, window.devicePixelRatio, expanded);
  const glassScale = glassRenderScale(size.width, size.height, ratio, walkthrough);

  useLayoutEffect(() => {
    setDpr(ratio);
    renderer.current.transmissionResolutionScale = glassScale;
    renderer.current.domElement.setAttribute('data-render-dpr', ratio.toFixed(3));
    renderer.current.domElement.setAttribute('data-render-quality', 'full-hd');
    invalidate();
  }, [ratio, glassScale, setDpr, invalidate]);

  useFrame(state => {
    // Parent updates must not reset the locked, sharp resolution.
    if (Math.abs(state.viewport.dpr - ratio) > 0.001) {
      setDpr(ratio);
      invalidate();
    }
    renderer.current.transmissionResolutionScale = glassScale;
  });
  return null;
}

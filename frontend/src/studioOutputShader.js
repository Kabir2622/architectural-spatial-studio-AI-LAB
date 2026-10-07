import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Keep HDR precision, ACES exposure and sRGB output, but avoid writing and
// rereading a second full-resolution texture solely for tone mapping.
export const StudioOutputShader = {
  ...FXAAShader,
  uniforms: { ...FXAAShader.uniforms, toneMappingExposure: { value: 1.05 } },
  fragmentShader: FXAAShader.fragmentShader
    .replace('uniform sampler2D tDiffuse;', `uniform sampler2D tDiffuse;
      #include <tonemapping_pars_fragment>`)
    .replace('gl_FragColor = ApplyFXAA( tDiffuse, resolution.xy, vUv );', `
      gl_FragColor = ApplyFXAA( tDiffuse, resolution.xy, vUv );
      gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
      gl_FragColor = sRGBTransferOETF(gl_FragColor);`)
};

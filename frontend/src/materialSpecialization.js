// Fixed finish values can be compiled as constants. The driver can then remove
// unused branches and fold BRDF arithmetic without changing the material model.
const fields = ['roughness', 'metalness', 'ior', 'specularIntensity', 'clearcoat', 'clearcoatRoughness'];
export function physicalConstants(material) {
  return fields.filter(key => Number.isFinite(material[key])).map(key => [key, material[key]]);
}

export function specializePhysicalShader(shader, constants) {
  for (const [name, value] of constants) {
    shader.fragmentShader = shader.fragmentShader.replace(
      `uniform float ${name};`, `const float ${name} = ${Number(value).toFixed(9)};`
    );
  }
}

export function specializePhysicalMaterial(material) {
  const compile = material.onBeforeCompile;
  const cache = material.customProgramCacheKey;
  let key = '';
  const refresh = () => {
    const next = JSON.stringify(physicalConstants(material));
    if (next !== key) { key = next; material.needsUpdate = true; }
  };
  material.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer);
    specializePhysicalShader(shader, physicalConstants(this));
    if (this.fog && !this.transparent && this.opacity === 1 && !this.transmission) {
      // A fully fogged studio pixel has exactly the fog color. Avoid computing
      // lights, environment BRDFs and shadow filters that contribute zero to it.
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', `void main() {
        #if defined(USE_FOG) && !defined(FOG_EXP2)
          if (vFogDepth >= fogFar) {
            gl_FragColor = vec4(fogColor, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
          }
        #endif
      `);
    }
  };
  material.customProgramCacheKey = function() { return `${cache.call(this)}:fixed:${key}`; };
  refresh();
  return { refresh, dispose() {
    material.onBeforeCompile = compile;
    material.customProgramCacheKey = cache;
    material.needsUpdate = true;
  } };
}

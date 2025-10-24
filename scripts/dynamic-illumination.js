// Dynamic Illumination — v12-safe fullscreen grading via PIXI.Filter

const TIME_PRESETS = {
  morning: { name: "Morning",  darkness: 0.2, exposure:  0.10, contrast:  0.00, saturation:  0.05, tint: "#ffe6b3" },
  noon:    { name: "Noon",     darkness: 0.0, exposure:  0.25, contrast:  0.05, saturation:  0.00, tint: "#ffffff" },
  dusk:    { name: "Dusk",     darkness: 0.4, exposure: -0.05, contrast: -0.05, saturation: -0.10, tint: "#b77cff" },
  night:   { name: "Night",    darkness: 0.7, exposure: -0.25, contrast: -0.20, saturation: -0.25, tint: "#3a246b" }
};

const ShaderFrag = `
  precision mediump float;
  varying vec2 vTextureCoord;
  uniform sampler2D uSampler;

  uniform float uExposure;   // stops
  uniform float uContrast;   // -1..+1 (0 = none)
  uniform float uSaturation; // -1..+1 (0 = none)
  uniform vec3  uTint;       // 0..1 rgb

  vec3 applyExposure(vec3 c, float stops) {
    return c * exp2(stops);
  }
  vec3 applyContrast(vec3 c, float amt) {
    // amt -1..+1; 0 = no change. pivot 0.5
    return mix(vec3(0.5), c, 1.0 + amt);
  }
  vec3 applySaturation(vec3 c, float amt) {
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(luma), c, 1.0 + amt);
  }

  void main() {
    vec4 col = texture2D(uSampler, vTextureCoord);
    vec3 rgb = col.rgb;
    rgb = applyExposure(rgb, uExposure);
    rgb = applyContrast(rgb, uContrast);
    rgb = applySaturation(rgb, uSaturation);
    rgb *= uTint;
    gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), col.a);
  }
`;

let _diFilter;

function _ensureFilter() {
  if (_diFilter) return _diFilter;
  _diFilter = new PIXI.Filter(undefined, ShaderFrag, {
    uExposure: 0.0,
    uContrast: 0.0,
    uSaturation: 0.0,
    uTint: [1,1,1]
  });
  // Attach to the whole scene
  const stage = canvas?.app?.stage;
  if (stage) stage.filters = [...(stage.filters ?? []), _diFilter];
  return _diFilter;
}

function _hexToRgb01(hex) {
  const n = parseInt(hex.replace("#",""), 16);
  return [(n>>16&255)/255, (n>>8&255)/255, (n&255)/255];
}

async function applyTimePreset(key) {
  const preset = TIME_PRESETS[key];
  if (!preset || !canvas?.scene) return ui.notifications?.warn?.(`Dynamic Illumination | Unknown preset: ${key}`);

  // Update darkness (uses Foundry’s built-in day/night mechanics)
  await canvas.scene.update({ darkness: preset.darkness });

  // Drive the postprocess uniforms
  const f = _ensureFilter();
  f.uniforms.uExposure   = preset.exposure;
  f.uniforms.uContrast   = preset.contrast;
  f.uniforms.uSaturation = preset.saturation;
  f.uniforms.uTint       = _hexToRgb01(preset.tint);

  // Re-render lighting/vision so players see the change right away
  await canvas.perception.update({ refreshLighting: true, refreshVision: true });

  ui.notifications?.info?.(`Dynamic Illumination | Scene set to ${preset.name}`);
}

// Toolbar (GM only)
Hooks.on("getSceneControlButtons", (controls) => {
  controls.push({
    name: "dynamic-illumination",
    title: "Dynamic Illumination",
    icon: "fas fa-sun",
    layer: "lighting",
    visible: game.user.isGM,
    tools: [
      { name: "morning", title: "Morning",     icon: "fas fa-sun",            onClick: () => applyTimePreset("morning"), button: true },
      { name: "noon",    title: "Noon",        icon: "fas fa-cloud-sun",      onClick: () => applyTimePreset("noon"),    button: true },
      { name: "dusk",    title: "Dusk",        icon: "fas fa-cloud-sun-rain", onClick: () => applyTimePreset("dusk"),    button: true },
      { name: "night",   title: "Night",       icon: "fas fa-moon",           onClick: () => applyTimePreset("night"),   button: true }
    ]
  });
});

// Reattach the filter when the canvas is ready/swapped
Hooks.on("canvasReady", _ensureFilter);
Hooks.once("ready", () => console.log("Dynamic Illumination | v12 postprocess ready."));

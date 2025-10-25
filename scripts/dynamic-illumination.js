// PAL Illumination — v12-safe fullscreen grading via PIXI.Filter
// Small Time REQUIRED. Per-scene "Smalltime Illuminations" that owns darkness (ST Darkness Control NOT required).

const MODULE_ID   = "palillumination";
const FLAG_PRESET = "preset";
const ST_MODULE   = "smalltime";

// Per-scene flag key for enabling the integration
const SCENE_FLAG_STI = "smalltime-illuminations";

const TIME_PRESETS = {
  morning:  { name: "Morning",  darkness: 0.2, exposure:  0.25, contrast:  0.05, saturation:  0.06, tint: "#ffd56e" },
  noon:     { name: "Noon",     darkness: 0.0, exposure:  0.25, contrast:  0.05, saturation:  0.00, tint: "#ffffff" },
  dusk:     { name: "Dusk",     darkness: 0.4, exposure: -0.05, contrast: -0.05, saturation: -0.06, tint: "#8aacff" },
  midnight: { name: "Midnight", darkness: 0.5, exposure: -0.16, contrast: -0.08, saturation: -0.10, tint: "#6e5cff" },
  clearLighting:    { name: "clearLighting",    darkness: 0.0, exposure: 0, contrast: 0, saturation: 0, tint: "#ffffff" }
};

const NEUTRAL = { exposure: 0, contrast: 0, saturation: 0, tint: "#ffffff" };
const SCENE_STATE = new Map();

const ShaderFrag = /* glsl */`
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform vec3  uTint;

vec3 applyExposure(vec3 c, float stops) { return c * exp2(stops); }
vec3 applyContrast(vec3 c, float amt)   { return mix(vec3(0.5), c, 1.0 + amt); }
vec3 applySaturation(vec3 c, float amt) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luma), c, 1.0 + amt);
}
void main() {
  vec4 col = texture2D(uSampler, vTextureCoord);
  vec3 rgb = col.rgb;
  rgb = applyExposure(rgb,   uExposure);
  rgb = applyContrast(rgb,   uContrast);
  rgb = applySaturation(rgb, uSaturation);
  rgb *= uTint;
  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), col.a);
}
`;

let _diFilter = null;

// ---------- utils ----------
function _hexToRgb01(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function _normKey(k) { return (k ?? "").toString().trim().toLowerCase(); }
function _lerp(a, b, t) { return a + (b - a) * t; }

// ---- scene flags / gates ----
function _isSceneSTIEnabled(scene = canvas?.scene) {
  if (!scene) return false;
  return !!scene.getFlag(MODULE_ID, SCENE_FLAG_STI);
}
function _disableSmallTimeDarknessLinkIfNeeded(scene = canvas?.scene) {
  if (!scene || !game.user.isGM) return;
  if (scene.getFlag(ST_MODULE, "darkness-link")) {
    scene.setFlag(ST_MODULE, "darkness-link", false).catch(()=>{});
  }
}

// ---------- filter attach/keepalive ----------
function _ensureFilter() {
  const stage = canvas?.stage;
  const renderer = canvas?.app?.renderer;
  if (!stage || !renderer) return null;

  if (!_diFilter) {
    _diFilter = new PIXI.Filter(undefined, ShaderFrag, {
      uExposure: 0.0, uContrast: 0.0, uSaturation: 0.0, uTint: [1,1,1]
    });
    _diFilter.padding = 0;
    _diFilter.autoFit = false;
    _diFilter.resolution = renderer.resolution;
  }

  stage.filterArea = renderer.screen;
  const current = stage.filters ?? [];
  if (!current.includes(_diFilter)) stage.filters = [...current, _diFilter];
  return _diFilter;
}
function _detachFilter() {
  const stage = canvas?.stage;
  if (!stage || !stage.filters?.length) return;
  stage.filters = stage.filters.filter(f => f !== _diFilter);
}
function _destroyFilter() { _detachFilter(); if (_diFilter) { try{_diFilter.destroy(true);}catch(_){} _diFilter = null; } }
function _kickstartFilter(frames = 6) {
  let left = Math.max(0, frames|0);
  const step = () => { _ensureFilter(); if (left-- > 0) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ---------- uniforms / presets ----------
function _applyUniforms({ exposure, contrast, saturation, tint }) {
  const f = _ensureFilter();
  if (!f) return false;
  f.uniforms.uExposure   = Math.clamped(exposure,   -4, 4);
  f.uniforms.uContrast   = Math.clamped(contrast,   -1, 1);
  f.uniforms.uSaturation = Math.clamped(saturation, -1, 1);
  f.uniforms.uTint       = _hexToRgb01(tint);
  return true;
}

// ---------- timeline mapping ----------
const _TL = [
  { h:  0, key: "midnight" },
  { h:  7, key: "morning"  },
  { h: 12, key: "noon"     },
  { h: 19, key: "morning"  }, // evening uses morning look
  { h: 22, key: "dusk"     },
  { h: 24, key: "midnight" }
];
function _segmentForHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < _TL.length - 1; i++) {
    const a = _TL[i], b = _TL[i + 1];
    if (h >= a.h && h < b.h) {
      const span = b.h - a.h;
      const t = span > 0 ? (h - a.h) / span : 0;
      return { fromKey: a.key, toKey: b.key, t };
    }
  }
  return { fromKey: "noon", toKey: "noon", t: 0 };
}

// ---------- apply from time (PAL owns darkness for STI scenes) ----------
async function _applyFromHour(hour, { setDarkness = true } = {}) {
  const seg = _segmentForHour(hour);
  const A = TIME_PRESETS[seg.fromKey], B = TIME_PRESETS[seg.toKey];
  if (!A || !B) return;

  _ensureFilter();
  const f = _ensureFilter();
  if (!f) return;

  // uniforms
  f.uniforms.uExposure   = Math.clamped(_lerp(A.exposure,   B.exposure,   seg.t), -4,  4);
  f.uniforms.uContrast   = Math.clamped(_lerp(A.contrast,   B.contrast,   seg.t), -1,  1);
  f.uniforms.uSaturation = Math.clamped(_lerp(A.saturation, B.saturation, seg.t), -1,  1);
  const a = _hexToRgb01(A.tint), b = _hexToRgb01(B.tint);
  f.uniforms.uTint = [ _lerp(a[0], b[0], seg.t), _lerp(a[1], b[1], seg.t), _lerp(a[2], b[2], seg.t) ];

  // darkness
  if (setDarkness && game.user.isGM) {
    const d = Math.clamped(_lerp(A.darkness, B.darkness, seg.t), 0, 1);
    try { await canvas.scene.update({ darkness: d }, { diff: true }); } catch(_) {}
  }
}

function _hmFromWorldTime(worldSeconds) {
  const dayLen = Number(CONFIG.time?.dayLength ?? 86400);
  const sec = ((worldSeconds % dayLen) + dayLen) % dayLen;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return { h, m };
}
function _currentHMFromWorld() {
  const wt = Number(game.time?.worldTime);
  if (Number.isFinite(wt)) return _hmFromWorldTime(wt);
  return null;
}
async function _applyFromSmallTimeNow() {
  if (!_isSceneSTIEnabled()) return;
  const hm = _currentHMFromWorld();
  if (!hm) return;
  const hour = ((hm.h + hm.m / 60) % 24 + 24) % 24;
  await _applyFromHour(hour, { setDarkness: true });
}

// ---- Parse Small Time socket payloads safely ----
function _hmFromPayload(payload) {
  if (payload == null) return null;

  if (typeof payload === "number") {
    let mins = payload > 1440 ? Math.floor(payload / 60) : Math.floor(payload);
    mins = ((mins % 1440) + 1440) % 1440;
    return { h: Math.floor(mins / 60), m: mins % 60 };
  }
  if (typeof payload === "string") {
    const m = payload.match(/^(\d{1,2}):(\d{2})/);
    if (m) return { h: Number(m[1]) % 24, m: Number(m[2]) % 60 };
  }
  if (typeof payload === "object") {
    if ("hour" in payload && "minute" in payload) {
      return { h: Number(payload.hour) % 24, m: Number(payload.minute) % 60 };
    }
    if ("h" in payload && "m" in payload) {
      return { h: Number(payload.h) % 24, m: Number(payload.m) % 60 };
    }
    if ("worldTime" in payload) {
      const wt = Number(payload.worldTime);
      if (!Number.isNaN(wt)) return _hmFromWorldTime(wt);
    }
    if ("seconds" in payload) {
      const s = Number(payload.seconds);
      if (!Number.isNaN(s)) return _hmFromPayload(s);
    }
  }
  return null;
}

// --- RAF watcher for live slider updates (tracks worldTime) ---
let _stiRaf = null;
let _stiLastWT = null;
function _stiLoop() {
  if (!canvas?.scene || !_isSceneSTIEnabled(canvas.scene)) {
    _stopSTIWatcher();
    return;
  }
  const wt = Number(game.time?.worldTime);
  if (Number.isFinite(wt) && wt !== _stiLastWT) {
    _stiLastWT = wt;
    _applyFromSmallTimeNow().catch(()=>{});
  }
  _stiRaf = requestAnimationFrame(_stiLoop);
}
function _startSTIWatcher() {
  if (_stiRaf) return;
  _stiLastWT = null; // force immediate apply
  _stiRaf = requestAnimationFrame(_stiLoop);
}
function _stopSTIWatcher() {
  if (_stiRaf) cancelAnimationFrame(_stiRaf);
  _stiRaf = null;
  _stiLastWT = null;
}

// ------------- manual preset API (when STI OFF) -------------
async function applyTimePreset(key, opts = {}) {
  const { changeDarkness = true, fromFlag = false } = opts;
  const preset = TIME_PRESETS[key];
  if (!preset) return ui?.notifications?.warn?.(`PAL Illumination | Unknown preset: ${key}`);
  if (!canvas?.scene) return;

  if (_isSceneSTIEnabled()) {
    ui?.notifications?.info?.(`PAL Illumination | Smalltime Illuminations is enabled; timeline controls look.`);
    return;
  }

  const f = _ensureFilter();
  if (!f) return;

  SCENE_STATE.set(canvas.scene.id, key);

  if (!fromFlag && game.user.isGM) {
    try {
      const current = _normKey(canvas.scene.getFlag(MODULE_ID, FLAG_PRESET));
      if (current !== key) await canvas.scene.setFlag(MODULE_ID, FLAG_PRESET, key);
    } catch (err) { console.warn(`PAL Illumination | Failed to set scene flag`, err); }
  }

  if (changeDarkness && game.user.isGM) {
    const newDarkness = Math.clamped(preset.darkness, 0, 1);
    try { await canvas.scene.update({ darkness: newDarkness }); } catch (err) {
      console.warn("PAL Illumination | Darkness update failed", err);
    }
  }

  await canvas.perception.update({ refreshLighting: true, refreshVision: true });
  await canvas.environment?.updateLighting?.();
  _kickstartFilter(2);
  _applyUniforms(preset);
  ui?.notifications?.info?.(`PAL Illumination | Scene set to ${preset.name}`);
}

async function _applyForScene(scene) {
  const scn = scene ?? canvas?.scene;
  if (!scn) return;

  _ensureFilter();

  if (_isSceneSTIEnabled(scn)) {
    // Ensure ST darkness-link is OFF so ST can't change darkness
    _disableSmallTimeDarknessLinkIfNeeded(scn);
    await _applyFromSmallTimeNow(); // uniforms + darkness from timeline
    return;
  }

  // STI disabled → session > flag > neutral
  const stateKey = _normKey(SCENE_STATE.get(scn.id));
  if (stateKey && TIME_PRESETS[stateKey]) { _applyUniforms(TIME_PRESETS[stateKey]); return; }

  const flagKey = _normKey(scn.getFlag(MODULE_ID, FLAG_PRESET));
  if (flagKey && TIME_PRESETS[flagKey]) {
    SCENE_STATE.set(scn.id, flagKey);
    await applyTimePreset(flagKey, { changeDarkness: true, fromFlag: true });
    return;
  }

  _applyUniforms(NEUTRAL);
}

// ---------- TOOLBAR (kept EXACT style; includes Midnight) ----------
Hooks.on("getSceneControlButtons", (controls) => {
  const lighting = controls.find(c => c.name === "lighting");
  if (!lighting) return;
  if (game.user.isGM) {
    lighting.tools.push(
      { name: "morning",  title: "Morning",  icon: "fas fa-sun",              onClick: () => applyTimePreset("morning"),  button: true },
      { name: "noon",     title: "Noon",     icon: "fas fa-cloud-sun",        onClick: () => applyTimePreset("noon"),     button: true },
      { name: "dusk",     title: "Dusk",     icon: "fas fa-cloud-sun-rain",   onClick: () => applyTimePreset("dusk"),     button: true },
      { name: "midnight", title: "Midnight", icon: "fas fa-star-and-crescent",onClick: () => applyTimePreset("midnight"), button: true },
      { name: "clearLighting",    title: "clearLighting",    icon: "fas fa-moon",             onClick: () => applyTimePreset("clearLighting"),    button: true }
    );
    console.log("PAL Illumination | Lighting toolbar buttons added");
  }
});

// ---------- SCENE CONFIG: add "Smalltime Illuminations" checkbox ----------
Hooks.on("renderSceneConfig", (app, html) => {
  try {
    const scene = app.object;
    const enabled = !!scene.getFlag(MODULE_ID, SCENE_FLAG_STI);
    const $lightingTab = html.find('.tab[data-tab="lighting"]');
    const row = $(`
      <div class="form-group">
        <label>Smalltime Illuminations</label>
        <div class="form-fields">
          <input type="checkbox" name="flags.${MODULE_ID}.${SCENE_FLAG_STI}" ${enabled ? "checked" : ""}/>
        </div>
        <p class="notes">Enable PAL’s time-based color grading and darkness for this scene. Small Time provides time; PAL controls darkness & tint.</p>
      </div>
    `);
    if ($lightingTab.length) $lightingTab.append(row);
    else html.find("form").append(row);
  } catch (e) {
    console.warn("PAL Illumination | renderSceneConfig injection failed", e);
  }
});

// ---------- HOOKS ----------
Hooks.on("canvasReady", () => {
  _kickstartFilter(6);
  _applyForScene();
  if (_isSceneSTIEnabled()) _startSTIWatcher(); else _stopSTIWatcher();
});
Hooks.on("canvasInit", () => { _kickstartFilter(3); });

// Track our own preset flag AND the per-scene STI toggle
Hooks.on("updateScene", async (scene, changed) => {
  if (scene.id !== canvas?.scene?.id) return;

  // Our module preset flag (only matters when STI is OFF)
  const pal = changed?.flags?.[MODULE_ID];
  if (pal && Object.prototype.hasOwnProperty.call(pal, FLAG_PRESET)) {
    const key = _normKey(pal[FLAG_PRESET]);
    if (key && TIME_PRESETS[key]) SCENE_STATE.set(scene.id, key);
    await _applyForScene(scene);
  }

  // The per-scene "Smalltime Illuminations" toggle
  if (pal && Object.prototype.hasOwnProperty.call(pal, SCENE_FLAG_STI)) {
    if (scene.getFlag(MODULE_ID, SCENE_FLAG_STI)) _disableSmallTimeDarknessLinkIfNeeded(scene);
    await _applyForScene(scene);
    if (_isSceneSTIEnabled(scene)) _startSTIWatcher(); else _stopSTIWatcher();
  }

  // If darkness changes while STI is ON (another module poked it), re-assert ours next frame
  if (_isSceneSTIEnabled(scene) && Object.prototype.hasOwnProperty.call(changed, "darkness")) {
    requestAnimationFrame(() => _applyFromSmallTimeNow().catch(()=>{}));
  }

  // If someone toggles Small Time's darkness-link back on while STI is enabled, turn it off again.
  const st = changed?.flags?.[ST_MODULE];
  if (_isSceneSTIEnabled(scene) && st && Object.prototype.hasOwnProperty.call(st, "darkness-link")) {
    _disableSmallTimeDarknessLinkIfNeeded(scene);
    requestAnimationFrame(() => _applyFromSmallTimeNow().catch(()=>{}));
  }
});

// Follow Small Time socket: after ST processes, apply from its time (PAL owns darkness for STI scenes)
Hooks.on("ready", () => {
  if (!game.socket) return;
  game.socket.on(`module.${ST_MODULE}`, (data) => {
    if (!data || data.type !== "changeTime") return;
    if (!_isSceneSTIEnabled()) return;

    setTimeout(() => {
      try {
        const hm = _hmFromPayload(data.payload) ?? _currentHMFromWorld();
        if (hm) {
          const hour = ((hm.h + hm.m/60)%24+24)%24;
          _applyFromHour(hour, { setDarkness: true }).catch(()=>{});
        }
      } catch (_) {}
    }, 0);
  });
});

// Keep filter glued on during other refreshes
Hooks.on("lightingRefresh", () => _ensureFilter());
Hooks.on("perceptionRefresh", () => _ensureFilter());
Hooks.on("controlToken", () => _ensureFilter());

// Cleanup
Hooks.on("canvasTearDown", () => { _stopSTIWatcher(); _detachFilter(); });
Hooks.once("shutdown", () => { _stopSTIWatcher(); _destroyFilter(); });
Hooks.once("ready", () => console.log("PAL Illumination | v12 + STI (PAL owns darkness, live worldTime watcher) ready."));


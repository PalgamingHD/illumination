// dynamic-illumination.js — Foundry VTT v12 version
// Scene-wide time-of-day tint control using ColorAdjustmentsSamplerShader

const TIME_PRESETS = {
  morning: {
    name: "Morning",
    brightness: 0.1,
    contrast: 0.0,
    saturation: 0.05,
    tintColor: "#ffe6b3" // pale gold
  },
  noon: {
    name: "Noon",
    brightness: 0.25,
    contrast: 0.05,
    saturation: 0.0,
    tintColor: "#ffffff"
  },
  dusk: {
    name: "Dusk",
    brightness: -0.05,
    contrast: -0.05,
    saturation: -0.1,
    tintColor: "#b77cff" // soft golden-purple
  },
  night: {
    name: "Night",
    brightness: -0.25,
    contrast: -0.2,
    saturation: -0.25,
    tintColor: "#3a246b" // deep purple-blue
  }
};

/**
 * Apply color adjustments to the active scene.
 */
async function applyTimePreset(timeKey) {
  const preset = TIME_PRESETS[timeKey];
  if (!preset) return ui.notifications.warn(`Unknown time preset: ${timeKey}`);

  const scene = game.scenes.current;
  if (!scene) return;

  // Update the Scene's color adjustments shader data
  await scene.update({
    "colorAdjustment": {
      "brightness": preset.brightness,
      "contrast": preset.contrast,
      "saturation": preset.saturation,
      "tint": preset.tintColor
    }
  });

  ui.notifications.info(`Illumination set to ${preset.name} 2`);
}

/**
 * Add toolbar buttons under Lighting Controls.
 */
Hooks.on("getSceneControlButtons", (controls) => {
  const lighting = controls.find(c => c.name === "lighting");
  if (!lighting) return;

  lighting.tools.push(
    {
      name: "illumination-morning",
      title: "Set Morning Lighting",
      icon: "fas fa-sun",
      onClick: () => applyTimePreset("morning")
    },
    {
      name: "illumination-noon",
      title: "Set Noon Lighting",
      icon: "fas fa-sun-bright",
      onClick: () => applyTimePreset("noon")
    },
    {
      name: "illumination-dusk",
      title: "Set Dusk Lighting",
      icon: "fas fa-cloud-sun",
      onClick: () => applyTimePreset("dusk")
    },
    {
      name: "illumination-night",
      title: "Set Night Lighting",
      icon: "fas fa-moon",
      onClick: () => applyTimePreset("night")
    }
  );
});

/**
 * Initialize hook.
 */
Hooks.once("init", () => {
  console.log("Dynamic Illumination (v12 Shader Edition) | Initialized.");
});

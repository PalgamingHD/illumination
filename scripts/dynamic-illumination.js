/**
 * Dynamic Illumination v12
 * PalgamingHD fork — Foundry VTT v12 only
 * 
 * Adds time-of-day presets that adjust global scene tone
 * using the new ColorAdjustmentsSamplerShader properties.
 */

const TIME_PRESETS = {
  morning: {
    name: "Morning",
    darkness: 0.2,
    exposure: 0.1,
    contrast: 0.0,
    saturation: 0.05,
    tint: "#ffe6b3" // warm golden
  },
  noon: {
    name: "Noon",
    darkness: 0.0,
    exposure: 0.25,
    contrast: 0.05,
    saturation: 0.0,
    tint: "#ffffff" // neutral white
  },
  dusk: {
    name: "Dusk",
    darkness: 0.4,
    exposure: -0.05,
    contrast: -0.05,
    saturation: -0.10,
    tint: "#b77cff" // golden-purple hue
  },
  night: {
    name: "Night",
    darkness: 0.7,
    exposure: -0.25,
    contrast: -0.20,
    saturation: -0.25,
    tint: "#3a246b" // dark violet
  }
};

/**
 * Apply a given time-of-day preset to the current scene.
 */
async function applyTimePreset(key) {
  const preset = TIME_PRESETS[key];
  if (!preset) {
    ui.notifications.warn(`Dynamic Illumination | Unknown preset: ${key}`);
    return;
  }

  const scene = game.scenes.current;
  if (!scene) {
    ui.notifications.warn("Dynamic Illumination | No active scene.");
    return;
  }

  console.log(`Dynamic Illumination | Applying preset: ${preset.name}`);

  // Update scene darkness and color adjustments
  await scene.update({
    darkness: preset.darkness,
    colorAdjustments: {
      exposure: preset.exposure,
      contrast: preset.contrast,
      saturation: preset.saturation,
      tint: preset.tint
    }
  });

  ui.notifications.info(`Dynamic Illumination | Scene set to ${preset.name}`);
}

/**
 * Add control buttons to the scene control bar.
 */
Hooks.on("getSceneControlButtons", controls => {
  controls.push({
    name: "dynamic-illumination",
    title: "Dynamic Illumination",
    icon: "fas fa-sun",
    layer: "lighting",
    tools: [
      {
        name: "morning",
        title: "Morning",
        icon: "fas fa-sun",
        onClick: () => applyTimePreset("morning"),
        button: true
      },
      {
        name: "noon",
        title: "Noon",
        icon: "fas fa-cloud-sun",
        onClick: () => applyTimePreset("noon"),
        button: true
      },
      {
        name: "dusk",
        title: "Dusk",
        icon: "fas fa-cloud-sun-rain",
        onClick: () => applyTimePreset("dusk"),
        button: true
      },
      {
        name: "night",
        title: "Night",
        icon: "fas fa-moon",
        onClick: () => applyTimePreset("night"),
        button: true
      }
    ]
  });
});

/**
 * Debug log for loading confirmation.
 */
Hooks.once("ready", () => {
  console.log("Dynamic Illumination | v12 module loaded and ready.");
});

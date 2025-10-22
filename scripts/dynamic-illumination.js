// dynamic-illumination.js — v12 compatible
// Simple time-of-day lighting tint controller for Foundry VTT v12
// Author: [Your Name or Fork Tag]
// License: Same as original delVhariant/illumination module

/**
 * CONFIGURATION
 * You can tweak color and intensity below.
 */
const TIME_PRESETS = {
  morning: {
    name: "Morning",
    ambientColor: "#ffd9a5", // warm light gold
    ambientBrightness: 1.0,
    ambientDarkness: 0.2
  },
  noon: {
    name: "Noon",
    ambientColor: "#ffffff", // bright white
    ambientBrightness: 1.2,
    ambientDarkness: 0.0
  },
  dusk: {
    name: "Dusk",
    ambientColor: "#b388ff", // soft golden-purple hue
    ambientBrightness: 0.6,
    ambientDarkness: 0.4
  },
  night: {
    name: "Night",
    ambientColor: "#5a3b87", // deep purple
    ambientBrightness: 0.3,
    ambientDarkness: 0.7
  }
};

/**
 * Helper: Apply a preset to the current scene.
 */
async function applyTimePreset(timeKey) {
  const preset = TIME_PRESETS[timeKey];
  if (!preset) return ui.notifications.warn(`Unknown time preset: ${timeKey}`);

  const scene = game.scenes.current;
  if (!scene) return;

  await scene.update({
    "lighting.globalLight": true,
    "lighting.ambientColor": preset.ambientColor,
    "lighting.ambientBrightness": preset.ambientBrightness,
    "lighting.darkness": preset.ambientDarkness
  });

  ui.notifications.info(`Illumination set to ${preset.name}`);
}

/**
 * Build a simple control interface in the Lighting Layer toolbar.
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
 * Log module initialization.
 */
Hooks.once("init", () => {
  console.log("Dynamic Illumination v12 | Initialized.");
});

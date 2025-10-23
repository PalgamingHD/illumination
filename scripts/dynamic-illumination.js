const TIME_PRESETS = {
  morning: {
    name: "Morning",
    darkness: 0.2,
    exposure: 0.10,
    contrast: 0.0,
    saturation: 0.05,
    tintColor: "#ffe6b3"
  },
  noon: {
    name: "Noon",
    darkness: 0.0,
    exposure: 0.25,
    contrast: 0.05,
    saturation: 0.0,
    tintColor: "#ffffff"
  },
  dusk: {
    name: "Dusk",
    darkness: 0.4,
    exposure: -0.05,
    contrast: -0.05,
    saturation: -0.10,
    tintColor: "#b77cff"
  },
  night: {
    name: "Night",
    darkness: 0.7,
    exposure: -0.25,
    contrast: -0.20,
    saturation: -0.25,
    tintColor: "#3a246b"
  }
};

async function applyTimePreset(timeKey) {
  const preset = TIME_PRESETS[timeKey];
  if (!preset) {
    ui.notifications.warn(`Dynamic Illumination | Unknown time preset: ${timeKey}`);
    return;
  }

  const scene = game.scenes.current;
  if (!scene) {
    ui.notifications.warn("Dynamic Illumination | No active scene.");
    return;
  }

  // Update the scene darkness level
  await scene.update({ darkness: preset.darkness });

  // Update shader color adjustments
  await scene.update({
    "colorAdjustment": {
      exposure: preset.exposure,
      contrast: preset.contrast,
      saturation: preset.saturation,
      tint: preset.tintColor
    }
  });

  ui.notifications.info(`Dynamic Illumination | Scene set to ${preset.name}`);
}

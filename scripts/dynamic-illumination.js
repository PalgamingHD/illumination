// scripts/dynamic-illumination.js
// Ported/updated for Foundry v12
/* eslint-disable no-undef */

let colorChange; // module-scoped reference to the color dialog

class SceneColorChange {
  constructor() {
    this.messageDialog = null;
  }

  async displayWindow() {
    const current = {
      color: canvas.scene.getFlag("dynamic-illumination", "darknessColor"),
      darknessLevel: canvas.scene?.darkness ?? 0
    };
    try {
      const selections = await renderTemplate("modules/dynamic-illumination/templates/color_template.html", current);
      const d = new Dialog({
        title: game.i18n.localize("dynamic-illumination.customDialogTitle") || "Dynamic Illumination — Custom",
        content: selections,
        buttons: {
          select: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("dynamic-illumination.changeColorLabel") || "Change Color",
            callback: async (html) => {
              const level = Number(html.find('#di-level').val());
              const color = html.find('#di-color').val();
              await changeLighting(level, color);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("core.cancel") || "Cancel",
            callback: () => {}
          }
        },
        default: "select",
        close: () => {
          // nothing special for now
        }
      });
      d.render(true);
      this.messageDialog = d;
    } catch (err) {
      console.error("Dynamic Illumination | Error rendering color dialog", err);
    }
  }
}

async function changeLighting(level, color) {
  // Ensure numeric level
  level = Number(level);
  if (Number.isNaN(level)) {
    ui.notifications.error("Dynamic Illumination | Invalid darkness level.");
    return;
  }

  // If animations are enabled try to handle interrupts / existing animation state
  if (game.settings.get("dynamic-illumination", "animateDarknessChange")) {
    const lightingLayer = canvas.getLayer("LightingLayer");
    const currentlyAnimating = lightingLayer?._animating || canvas.scene.getFlag("dynamic-illumination", "_animating");

    if (currentlyAnimating) {
      if (game.settings.get("dynamic-illumination", "allowInterrupt")) {
        // terminate any named animations we use
        try {
          CanvasAnimation.terminateAnimation("lighting.animateDarkness");
          CanvasAnimation.terminateAnimation("lighting.darknessColor");
        } catch (err) {
          // CanvasAnimation.terminateAnimation exists in v12; swallow errors but log for debug
          console.debug("Dynamic Illumination | No running named CanvasAnimation to terminate or termination failed.", err);
        }
        if (lightingLayer) lightingLayer._animating = false;
        await canvas.scene.setFlag("dynamic-illumination", "_animating", false);
      } else {
        ui.notifications.warn(game.i18n.localize("dynamic-illumination.animatingWarning")
          || 'Scene color/darkness already animating. You can enable interrupting ongoing changes in settings.');
        return;
      }
    }

    // Trigger the scene darkness update with animation
    await canvas.scene.update({ darkness: level }, { animateDarkness: true });
    await interpolateSceneColor(color);
  } else {
    // Apply immediately without animation
    await canvas.scene.update({ darkness: level }, { animateDarkness: false });
    await SendColorChange(color);
  }
}

async function interpolateSceneColor(target = "#FFFEFF") {
  // Ensure flags to mark animation state
  await canvas.scene.setFlag("dynamic-illumination", "_animating", true);

  const interpolationData = [{
    parent: { interpolationSteps: 0 },
    attribute: "interpolationSteps",
    to: 20
  }];
  const duration = (game.settings.get("dynamic-illumination", "animationColorChangeDelay") ?? 7.5) * 1000;

  return CanvasAnimation.animateLinear(interpolationData, {
    name: "lighting.darknessColor",
    duration,
    ontick: (dt, attributes) => {
      const progress = attributes[0].parent.interpolationSteps / attributes[0].to;
      const fromColor = canvas.scene.getFlag("dynamic-illumination", "darknessColor") || "#000000";
      const color = interpolateColor(fromColor, target, progress);
      // Only update if changed
      if (color.toLowerCase() !== (fromColor || "").toLowerCase()) {
        SendColorChange(color);
      }
    }
  }).then(async () => {
    await canvas.scene.setFlag("dynamic-illumination", "_animating", false);
    // Ensure exact target at end
    await SendColorChange(target);
    console.log("Dynamic Illumination | finished color change");
  }).catch(async (err) => {
    // If the animation was terminated/errored, ensure flag is reset
    console.warn("Dynamic Illumination | color interpolation terminated or failed", err);
    await canvas.scene.setFlag("dynamic-illumination", "_animating", false);
  });
}

function interpolateColor(color1, color2, factor) {
  if (arguments.length < 3) {
    factor = 0.5;
  }
  const c1 = convertHexRGB(color1);
  const c2 = convertHexRGB(color2);
  const result = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    result[i] = Math.round(c1[i] + factor * (c2[i] - c1[i]));
  }
  return convertRGBHex(result[0], result[1], result[2]);
}

// Converts shorthand & full hex string to RGB array
const convertHexRGB = hex => (hex || "#000000").replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i, (m, r, g, b) => '#' + r + r + g + g + b + b)
  .substring(1).match(/.{2}/g)
  .map(x => parseInt(x, 16));

// Converts RGB array to hex string
const convertRGBHex = (r, g, b) => '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');

async function SendColorChange(color) {
  // Normalize color string
  color = color || "#000000";
  const convertedColor = PIXI.utils.string2hex(color);
  // Persist flag then update canvas configuration & layers
  await canvas.scene.setFlag("dynamic-illumination", "darknessColor", color);
  CONFIG.Canvas.darknessColor = convertedColor;

  if (game.settings.get("dynamic-illumination", "changeFogColor")) {
    CONFIG.Canvas.exploredColor = convertedColor;
    // In v12, calling canvas.sight.refresh() should re-evaluate fog color
    if (canvas.sight) canvas.sight.refresh();
  }

  // Emit a socket event with payload so other clients apply immediately
  try {
    game.socket.emit("module.dynamic-illumination", {
      sceneId: canvas.scene?.id,
      color
    });
  } catch (err) {
    console.warn("Dynamic Illumination | socket emit failed", err);
  }

  // Refresh the lighting layer so the color is applied immediately
  const lightingLayer = canvas.getLayer("LightingLayer");
  if (lightingLayer && typeof lightingLayer.refresh === "function") {
    lightingLayer.refresh();
  } else {
    canvas.requestRender();
  }
}

// Data can be either an object from socket or undefined - handle both.
function ReceiveColorChange(data) {
  let color;
  if (data && data.color) {
    color = data.color;
  } else {
    color = canvas.scene.getFlag("dynamic-illumination", "darknessColor");
  }

  const convertedColor = PIXI.utils.string2hex(color || "#000000");
  CONFIG.Canvas.darknessColor = convertedColor;

  if (game.settings.get("dynamic-illumination", "changeFogColor")) {
    CONFIG.Canvas.exploredColor = convertedColor;
    if (canvas.sight) canvas.sight.refresh();
  }

  const lightingLayer = canvas.getLayer("LightingLayer");
  if (lightingLayer && typeof lightingLayer.refresh === "function") {
    lightingLayer.refresh();
  } else {
    canvas.requestRender();
  }
}

// Register socket listener on ready
Hooks.once('ready', () => {
  try {
    game.socket.on('module.dynamic-illumination', (data) => {
      ReceiveColorChange(data);
    });
  } catch (err) {
    console.error("Dynamic Illumination | failed to register socket listener", err);
  }
});

// Add Dawn/Dusk/Custom buttons into the lighting scene controls (v12)
Hooks.on('getSceneControlButtons', controls => {
  // controls is an array of SceneControl objects
  const control = controls.find(c => c.name === "lighting");
  if (!control) return;

  // Day Button override - find index
  const dayIndex = control.tools.findIndex(t => t.name === "day");
  if (dayIndex > -1) {
    // override the onClick for the existing Day button to ensure it uses settings
    control.tools[dayIndex].onClick = () => {
      changeLighting(game.settings.get("dynamic-illumination", "dayLevel"), game.settings.get("dynamic-illumination", "dayColor"));
    };

    // Insert Dawn button before Day
    control.tools.splice(dayIndex, 0, {
      name: "dawn",
      title: "Transition to Dawn",
      icon: "fa-regular fa-sun",
      visible: game.settings.get("dynamic-illumination", "showDawnDusk"),
      onClick: () => changeLighting(game.settings.get("dynamic-illumination", "dawnLevel"), game.settings.get("dynamic-illumination", "dawnColor")),
      button: true
    });
  } else {
    console.error("Dynamic Illumination | Unable to locate 'Day' button in lighting toolbar.");
  }

  // Night Button override
  const nightIndex = control.tools.findIndex(t => t.name === "night");
  if (nightIndex > -1) {
    control.tools[nightIndex].onClick = () => {
      changeLighting(game.settings.get("dynamic-illumination", "nightLevel"), game.settings.get("dynamic-illumination", "nightColor"));
    };

    // Insert Dusk button before Night
    control.tools.splice(nightIndex, 0, {
      name: "dusk",
      title: "Transition to Dusk",
      icon: "fa-regular fa-moon",
      visible: game.settings.get("dynamic-illumination", "showDawnDusk"),
      onClick: () => changeLighting(game.settings.get("dynamic-illumination", "duskLevel"), game.settings.get("dynamic-illumination", "duskColor")),
      button: true
    });

    // Add custom color button after dusk (calculate position again: dusk inserted at nightIndex, so custom goes at nightIndex+1)
    control.tools.splice(nightIndex + 1, 0, {
      name: "custom",
      title: "Set to Custom",
      icon: "fa-solid fa-sliders-h",
      visible: game.settings.get("dynamic-illumination", "showDawnDusk"),
      onClick: () => {
        if (!colorChange) colorChange = new SceneColorChange();
        colorChange.displayWindow();
      },
      button: true
    });
  } else {
    console.error("Dynamic Illumination | Unable to locate 'Night' button in lighting toolbar.");
  }
});

// Initialization & settings
Hooks.once("init", () => {
  // Preload the dialog template
  loadTemplates(["modules/dynamic-illumination/templates/color_template.html"]);

  // Register settings (kept mostly as original)
  game.settings.register("dynamic-illumination", "allowInterrupt", {
    name: game.i18n.localize("dynamic-illumination.allowInterrupt.name"),
    hint: game.i18n.localize("dynamic-illumination.allowInterrupt.hint"),
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register("dynamic-illumination", "animateDarknessChange", {
    name: game.i18n.localize("dynamic-illumination.animateDarknessChange.name"),
    hint: game.i18n.localize("dynamic-illumination.animateDarknessChange.hint"),
    scope: "world",
    config: true,
    default: true,
    type: Boolean
  });

  game.settings.register("dynamic-illumination", "changeFogColor", {
    name: game.i18n.localize("dynamic-illumination.changeFogColor.name"),
    hint: game.i18n.localize("dynamic-illumination.changeFogColor.hint"),
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register("dynamic-illumination", "animationColorChangeDelay", {
    name: game.i18n.localize("dynamic-illumination.animationColorChangeDelay.name"),
    hint: game.i18n.localize("dynamic-illumination.animationColorChangeDelay.hint"),
    scope: "world",
    config: true,
    default: 7.5,
    type: Number,
    range: { min: 0.0, max: 60.0, step: 0.5 }
  });

  game.settings.register("dynamic-illumination", "showDawnDusk", {
    name: game.i18n.localize("dynamic-illumination.showDawnDusk.name"),
    hint: game.i18n.localize("dynamic-illumination.showDawnDusk.hint"),
    scope: "world",
    config: true,
    default: true,
    type: Boolean
  });

  // Colors and levels
  game.settings.register("dynamic-illumination", "dawnColor", {
    name: game.i18n.localize("dynamic-illumination.dawnColor.name"),
    hint: game.i18n.localize("dynamic-illumination.dawnColor.hint"),
    scope: "world",
    config: true,
    default: "#db9f6d",
    type: String
  });

  game.settings.register("dynamic-illumination", "dawnLevel", {
    name: game.i18n.localize("dynamic-illumination.dawnLevel.name"),
    hint: game.i18n.localize("dynamic-illumination.dawnLevel.hint"),
    scope: "world",
    config: true,
    default: 0.75,
    type: Number,
    range: { min: 0.0, max: 1.0, step: 0.05 }
  });

  game.settings.register("dynamic-illumination", "dayColor", {
    name: game.i18n.localize("dynamic-illumination.dayColor.name"),
    hint: game.i18n.localize("dynamic-illumination.dayColor.hint"),
    scope: "world",
    config: true,
    default: "#FFFEFE",
    type: String
  });

  game.settings.register("dynamic-illumination", "dayLevel", {
    name: game.i18n.localize("dynamic-illumination.dayLevel.name"),
    hint: game.i18n.localize("dynamic-illumination.dayLevel.hint"),
    scope: "world",
    config: true,
    default: 0,
    type: Number,
    range: { min: 0.0, max: 1.0, step: 0.05 }
  });

  game.settings.register("dynamic-illumination", "duskColor", {
    name: game.i18n.localize("dynamic-illumination.duskColor.name"),
    hint: game.i18n.localize("dynamic-illumination.duskColor.hint"),
    scope: "world",
    config: true,
    default: "#ae6b6b",
    type: String
  });

  game.settings.register("dynamic-illumination", "duskLevel", {
    name: game.i18n.localize("dynamic-illumination.duskLevel.name"),
    hint: game.i18n.localize("dynamic-illumination.duskLevel.hint"),
    scope: "world",
    config: true,
    default: 0.75,
    type: Number,
    range: { min: 0.0, max: 1.0, step: 0.05 }
  });

  game.settings.register("dynamic-illumination", "nightColor", {
    name: game.i18n.localize("dynamic-illumination.nightColor.name"),
    hint: game.i18n.localize("dynamic-illumination.nightColor.hint"),
    scope: "world",
    config: true,
    default: "#3c3351",
    type: String
  });

  game.settings.register("dynamic-illumination", "nightLevel", {
    name: game.i18n.localize("dynamic-illumination.nightLevel.name"),
    hint: game.i18n.localize("dynamic-illumination.nightLevel.hint"),
    scope: "world",
    config: true,
    default: 1,
    type: Number,
    range: { min: 0.0, max: 1.0, step: 0.05 }
  });
});

// Keep canvasReady logic but updated for v12 access patterns
Hooks.on("canvasReady", async () => {
  try {
    let color = canvas.scene.getFlag("dynamic-illumination", "darknessColor");

    if (game.user.isGM) {
      // Clean up old core flag if present (from prior versions)
      if (canvas.scene.getFlag("core", "darknessColor") !== undefined) {
        await canvas.scene.unsetFlag("core", "darknessColor");
      }
      // Ensure animating flag is reset for the scene
      await canvas.scene.setFlag("dynamic-illumination", "_animating", false);

      if (!color) {
        color = "#110033";
        await canvas.scene.setFlag("dynamic-illumination", "darknessColor", color);
      }
      await SendColorChange(color);
    } else {
      // Non-GMs should sync to the scene flag
      if (CONFIG.Canvas.darknessColor !== PIXI.utils.string2hex(color || "#000000")) {
        ReceiveColorChange({ color });
      }
    }
  } catch (err) {
    console.error("Dynamic Illumination | Error in canvasReady handler", err);
  }
});

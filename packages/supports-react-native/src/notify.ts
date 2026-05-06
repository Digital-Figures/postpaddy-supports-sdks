// Lightweight wrapper around optional sound + haptic deps.
// We never hard-require expo-av/expo-haptics — host apps may not have them.
let Audio: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Audio = require("expo-av")?.Audio ?? null;
} catch { /* optional */ }

let Haptics: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Haptics = require("expo-haptics") ?? null;
} catch { /* optional */ }

let _soundCache: any = null;

/** Play the bundled "new message" tone. Silently no-ops if expo-av is missing. */
export async function playNotificationSound(): Promise<void> {
  if (!Audio?.Sound) return;
  try {
    if (!_soundCache) {
      // Bundled tone is optional — apps can ship their own by overriding this hook later.
      let asset: any = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        asset = require("./assets/notify.mp3");
      } catch { return; }
      const { sound } = await Audio.Sound.createAsync(asset);
      _soundCache = sound;
    }
    await _soundCache.replayAsync();
  } catch { /* ignore — best-effort */ }
}

/** Trigger a light selection haptic. No-ops if expo-haptics is missing. */
export async function triggerNotificationHaptic(): Promise<void> {
  if (!Haptics?.impactAsync) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle?.Light ?? 0);
  } catch { /* ignore */ }
}

import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, SchedulableTriggerInputTypes } from 'expo-notifications';
import { Platform } from 'react-native';
import i18n from '../i18n';
import type { ScheduledSignal, SignalKind } from './engine';
import { GO_TONES, WARN_TONES, makeWav } from './wav';

/** Sound, haptics and background notifications for timekeeper signals. */

let players: Partial<Record<SignalKind, AudioPlayer>> = {};
let prepared: Promise<void> | null = null;

function prepareSounds(): Promise<void> {
  prepared ??= (async () => {
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' });
    for (const [kind, tones] of [
      ['warn', WARN_TONES],
      ['go', GO_TONES],
    ] as const) {
      const file = new File(Paths.cache, `timekeeper-${kind}.wav`);
      if (!file.exists) file.create();
      file.write(makeWav(tones));
      players[kind] = createAudioPlayer({ uri: file.uri });
    }
  })().catch(() => {
    // Sound is optional: a failure leaves haptics and the on-screen state working.
    prepared = null;
    players = {};
  });
  return prepared;
}

/** Beep and vibrate: one pulse for a warning, two for the final signal. */
export async function alertSignal(kind: SignalKind, soundOn: boolean): Promise<void> {
  void (
    kind === 'go'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  ).catch(() => {});
  if (!soundOn) return;
  await prepareSounds();
  const player = players[kind];
  if (player) {
    await player.seekTo(0);
    player.play();
  }
}

export const warmUpSounds = () => void prepareSounds();

/* ------------------------------------------------------------------ */
/* Notifications while backgrounded                                    */
/* ------------------------------------------------------------------ */

const CHANNEL = 'timekeeper-signals';
let scheduledIds: string[] = [];

export function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        // Shown in the system's notification settings; renamed when the language changes.
        name: i18n.t('timekeeper.channel'),
        importance: AndroidImportance.HIGH,
        // No `sound` key: omitting it gives the system default. A string here is
        // looked up as a bundled file, and 'default' logs "custom sound not found".
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Schedules every pending signal as a local notification; call when the app goes to the background. */
export async function scheduleSignals(
  title: string,
  signals: readonly ScheduledSignal[],
  text: (s: string) => string,
): Promise<void> {
  await cancelScheduledSignals();
  const now = Date.now();
  for (const s of signals) {
    if (s.atMs <= now + 500) continue;
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: { title, body: text(s.text), sound: 'default' },
        trigger: {
          type: SchedulableTriggerInputTypes.DATE,
          date: new Date(s.atMs),
          channelId: CHANNEL,
        },
      });
      scheduledIds.push(id);
    } catch {
      break; // no permission or too many scheduled: the rest cannot be scheduled either
    }
  }
}

/** Cancels scheduled signals; call when the app returns to the foreground or the timer ends. */
export async function cancelScheduledSignals(): Promise<void> {
  const ids = scheduledIds;
  scheduledIds = [];
  await Promise.all(
    ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})),
  );
}

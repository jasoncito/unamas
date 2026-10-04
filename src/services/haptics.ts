import * as Haptics from 'expo-haptics';

/** The stop's haptics (CLAUDE.md §8, screen 6). Silent when the Taptic Engine is off (Low Power Mode). */
export const haptics = {
  /** Every 250 ms while holding the stop, stronger as it goes: Light → Medium → Heavy. */
  holdTick(step: number): void {
    const style = step < 2 ? Haptics.ImpactFeedbackStyle.Light : step < 4 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Heavy;
    void Haptics.impactAsync(style).catch(() => {});
  },
  /** "Anotado": light, or a firmer one when it went up (M8). */
  logged(up: boolean): void {
    void Haptics.impactAsync(up ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  /** Screen 1: a muscle group tapped. */
  select(): void {
    void Haptics.selectionAsync().catch(() => {});
  },
  /** Weight landing (a plate on the bar, a stack settling, a dumbbell on the shelf): the heavier, the firmer. */
  thud(strength: 'light' | 'medium' | 'heavy'): void {
    const style = { light: Haptics.ImpactFeedbackStyle.Light, medium: Haptics.ImpactFeedbackStyle.Medium, heavy: Haptics.ImpactFeedbackStyle.Heavy }[strength];
    void Haptics.impactAsync(style).catch(() => {});
  },
  /** Something can't be done (the sleeve is full). */
  warn(): void {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
  /** A light tap: "Deshacer". */
  tap(): void {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  /** The stop completed. */
  success(): void {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
};

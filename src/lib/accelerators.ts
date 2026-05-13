/**
 * Platform-aware accelerator detection for ShellForge WebView shortcuts.
 * Uses navigator hints only; not a security boundary.
 */
export function isMacOsLike(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  if (/Mac/i.test(navigator.platform)) {
    return true;
  }

  return /Macintosh/i.test(navigator.userAgent);
}

/**
 * Cmd/Ctrl+Shift+<letter> chords for app-level actions (splits, workspaces,
 * terminal clipboard). On macOS both Cmd and Ctrl variants are accepted.
 */
export function isAccelShiftChord(event: KeyboardEvent): boolean {
  if (!event.shiftKey || event.altKey) {
    return false;
  }

  if (!isMacOsLike()) {
    return event.ctrlKey && !event.metaKey;
  }

  return event.metaKey || event.ctrlKey;
}

export function accelShiftChordLabel(): string {
  return isMacOsLike() ? "Cmd+Shift" : "Ctrl+Shift";
}

export function formatAccelShiftLetter(letter: string): string {
  const normalized = letter.length === 1 ? letter.toUpperCase() : letter;
  return `${accelShiftChordLabel()}+${normalized}`;
}

/** Modifier label for Option (macOS) vs Alt (Linux) panel navigation. */
export function altOptionLabel(): string {
  return isMacOsLike() ? "Option" : "Alt";
}

export function formatPanelNavigateChord(): string {
  return `${altOptionLabel()}+Arrow keys`;
}

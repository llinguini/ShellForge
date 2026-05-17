/**
 * ShellForge design tokens — single source of truth for colors, typography,
 * spacing, and terminal theme values.
 */

export const sf = {
  colors: {
    bg: "#0f0e0c",
    s1: "#171510",
    s2: "#1f1d17",
    s3: "#28251e",
    b1: "#333028",
    b2: "#444035",
    text: "#ede6d6",
    muted: "#6b6558",
    subtle: "#b0a890",
  },
  fonts: {
    ui: '"Inter", system-ui, -apple-system, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "DejaVu Sans Mono", monospace',
    brand: "Georgia, serif",
  },
  fontSize: {
    tab: "12px",
    menu: "12px",
    title: "13px",
    terminal: 13,
  },
  spacing: {
    tabBarHeight: 36,
    terminalPaddingX: 12,
    terminalPaddingY: 8,
  },
  radius: {
    menu: "4px",
    scrollbar: "3px",
  },
} as const;

export const xtermTheme = {
  background: sf.colors.bg,
  foreground: sf.colors.text,
  cursor: sf.colors.text,
  cursorAccent: sf.colors.bg,
  selectionBackground: sf.colors.b1,
  black: sf.colors.bg,
  white: sf.colors.text,
  brightBlack: sf.colors.muted,
  brightWhite: sf.colors.text,
} as const;

export const activePanelBorder = "rgba(237, 230, 214, 0.15)";

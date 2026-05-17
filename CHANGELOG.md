# Changelog

## [0.1.2] - 2026-05-17

### Changed

- Applied ShellForge design system across the UI: Tailwind tokens, Inter and
  JetBrains Mono fonts, warm dark palette, thin panel dividers, and restyled
  workspace tabs, context menu, scrollbars, and xterm theme

### Removed

- In-app custom title bar (ShellForge logo and window control buttons); native
  window decorations are used instead

## [0.1.1] - 2026-05-13

### Added

- macOS-style Cmd+Shift shortcuts for workspace, split, and clipboard actions
  (Ctrl+Shift remains supported on macOS)
- `Close workspace` entry in the terminal context menu with shortcut hint

### Changed

- README keyboard table documents Linux vs macOS modifiers and notes that
  shortcuts are built-in; shell signals stay on Ctrl on all platforms
- Context menu shortcut hints follow the active platform (Cmd vs Ctrl)

## [0.1.0] - 2025

### Added

- Native terminal emulator with real PTY via portable-pty
- Multiple workspaces with tab bar
- Split panels (horizontal and vertical) with drag-to-resize
- Fish-style history autocompletion with right arrow
- Context-aware history prioritizing current directory
- History deduplication
- Git branch in prompt
- Unix socket listener at /tmp/shellforge.sock
- Copy/paste support (Ctrl+Shift+C / Ctrl+Shift+V)
- .deb and .dmg build targets
- Release workflow derives bundle versions from Git tags
- Desktop bundle icons for Linux and macOS packages
- Current input syntax highlighting with configurable token colors
- Unicode-safe input buffer tracking for special and multi-byte characters

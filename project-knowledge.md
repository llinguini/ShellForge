# Project Knowledge

## Overview

ShellForge is a Tauri v2 desktop terminal emulator for Linux and macOS. The app
uses a Rust backend for PTY management and a React 18 + TypeScript frontend for
the workspace and split-panel xterm.js UI.

## Structure

- `src-tauri/src/pty.rs` owns PTY session creation, resizing, input writes, and
  output emission through Tauri events.
- `src-tauri/src/socket.rs` owns the Unix socket listener at
  `/tmp/shellforge.sock`; messages are logged only.
- `src/components/workspaceTree.ts` defines the recursive binary split tree and
  pure helpers for splitting, closing, collecting, and resizing panel nodes.
- `src/components/PanelTree.tsx` renders the recursive split tree and the 4px
  draggable dividers.
- `src/components/Terminal.tsx` owns each xterm.js instance and routes keystrokes
  to Rust with `write_to_pty`.
- `src/components/Terminal.tsx` caches xterm instances by panel id so layout
  remounts during splits or workspace switches preserve the visible buffer.
- `src/components/Terminal.tsx` also owns terminal clipboard behavior:
  Cmd/Ctrl+Shift+C, Cmd/Ctrl+Shift+V (platform rules in `src/lib/accelerators.ts`),
  context menu copy/paste, selection sync to Linux PRIMARY, and middle-click
  PRIMARY paste.
- `src/components/Terminal.tsx` intercepts ShellForge OSC history markers before
  writing PTY output to xterm, sends history entries through Tauri commands, and
  renders command suggestions as an overlay sibling of the xterm viewport.
- `src/components/App.tsx` owns workspace state, active panel focus, shortcuts,
  and context menu actions. Accelerator chords use `src/lib/accelerators.ts`:
  on macOS **Cmd+Shift** or **Ctrl+Shift** for splits, workspaces, and terminal
  copy/paste; on Linux **Ctrl+Shift** only for those chords. Panel navigation
  uses **Alt+Arrow** (Option+Arrow on macOS). Shell interrupt stays **Ctrl+C**
  (see `Terminal.tsx` `isInputAbort`).
- `src-tauri/src/history.rs` owns the SQLite command history database at
  `~/.shellforge/history.db`.
- Context menu items render action labels on the left and shortcut hints on the
  right using `.context-menu-shortcut`.
- UI styling uses Tailwind 3 with tokens in `src/lib/tokens.ts` and
  `tailwind.config.ts` (`sf-*` color utilities). Fonts: Inter (UI),
  JetBrains Mono (terminal). Window chrome uses the native OS title bar.
- npm commands should run under Node 20 via nvm:
  `nvm use 20` (v20.20.2 installed at `~/.nvm`).

## Runtime Notes

- The backend chooses `$SHELL` first, then falls back to common `zsh`, `bash`,
  and `sh` paths.
- Workspaces replaced the original tab concept. Each workspace contains one or
  more panels, and each panel has its own PTY id.
- Workspace titles are user-owned. New workspaces use monotonic names like
  `Workspace 1`, `Workspace 2`, and double-clicking a workspace tab edits the
  title inline.
- Terminal OSC title changes are ignored for workspace naming so shells cannot
  overwrite custom workspace names.
- Split direction semantics: `vertical` means side-by-side panels with a
  vertical divider; `horizontal` means stacked panels with a horizontal divider.
- `React.StrictMode` is intentionally not used because development double-mounts
  would create duplicate PTY sessions.
- Closing a panel or workspace must call `disposeTerminal(panelId)` as well as
  `close_pty`; ordinary React remounts should not dispose xterm instances.
- Linux clipboard support uses system tools from Rust commands. Preferred tools
  are `wl-copy`/`wl-paste`; fallback tools are `xsel` and `xclip`.
- PTYs intentionally start `bash --rcfile /tmp/shellforge_bash_init.sh` so
  ShellForge can inject Git branch prompt support and history capture.
- The injected bash init sources `~/.bashrc`, then replaces `PS1` with the
  previous Ubuntu-style colors: green `\u@\h`, blue `\w`, optional white Git
  branch segment, and a normal-color `> `. Keep prompt color escapes in `PS1`,
  not in `__sf_git_branch()`, because Bash does not parse `\[` markers emitted
  by command substitutions.
- The same init file emits OSC markers with command/cwd/exit code from
  `PROMPT_COMMAND`.
- History suggestions query SQLite by prefix and prefer commands from the same
  cwd. Duplicate commands are updated in place, and consecutive duplicates are
  skipped. `ArrowUp`/`ArrowDown` only intercept history navigation when the
  current input buffer is non-empty; an empty buffer still lets bash handle
  normal history navigation.
- Ghost text uses xterm internals
  `_core._renderService.dimensions.actualCellWidth/Height` with a DOM fallback.
  It is not written into the terminal buffer.
- `Terminal.tsx` tracks printable input from `KeyboardEvent.key` instead of
  ASCII-only PTY data. Backspace removes the last Unicode codepoint from the
  input buffer.
- The current input syntax overlay is separate from ghost text, uses the same
  xterm cell metrics, and colors tokens through `defaultSyntaxTheme`.

## Build Notes

- `npm run tauri:build:deb` targets Linux `.deb` packaging.
- `npm run tauri:build:dmg` targets macOS `.dmg` packaging.
- Tauri platform packages are still required on developer machines for native
  builds.
- Cursor's shell can put its internal Node helper before `nvm` in `PATH`.
  Prefer `nvm` explicitly for project commands:
  `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`.
- The Linux build was validated with Node `v20.20.2`, npm `10.8.2`, Rust
  `1.95.0`, Tauri CLI `2.11.1`, and WebKitGTK `2.48.3`.
- The release workflow derives the build version from `github.ref_name`
  tags like `v0.1.2`, then patches npm, Cargo, and Tauri metadata in the
  runner before bundling. Tauri artifact names use that patched metadata
  version.
- The release workflow needs `contents: write`, has workflow concurrency,
  and serializes Linux/macOS matrix builds so only one runner creates the
  GitHub release at a time.
- App icon source of truth: `src-tauri/icons/icon.svg` (ShellForge palette).
  Regenerate platform assets with `npx tauri icon src-tauri/icons/icon.svg -o
  src-tauri/icons`. Web favicon: `public/favicon.png` (from 32x32 export).
- `src-tauri/tauri.conf.json` must declare `bundle.icon`; otherwise the
  Linux `.deb` can generate a `.desktop` entry with `Icon=shellforge` but no
  installed files under `usr/share/icons`.
- The Linux `.deb` bundle is generated at
  `src-tauri/target/release/bundle/deb/ShellForge_<version>_amd64.deb` when
  `CARGO_TARGET_DIR="$PWD/src-tauri/target"` is set.

## Current Caveats

- Socket messages are intentionally logged and not handled.
- Clipboard PRIMARY support depends on installed Linux clipboard tools and the
  active display server.
- Ghost text currently targets normal end-of-line command entry; complex
  readline editing clears or may desync suggestions until the next prompt.
- macOS `.dmg` generation must be validated on macOS.

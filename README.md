# ShellForge

Open-source terminal emulator built with Tauri + Rust. Supports split panels,
fish-style autocompletion, git-aware prompt, and cloud sync via a local daemon —
no remote execution, your shell stays yours.

## Features

- Multiple workspaces with split panels (horizontal and vertical)
- Fish-style history autocompletion with right arrow
- Git branch in prompt
- Context-aware history (prioritizes commands used in current directory)
- Unix socket daemon ready for web sync
- Minimal, fast, native — built with Tauri + Rust

## Installation

### Linux (.deb)

Download the latest `.deb` from [Releases](../../releases) and run:

```bash
sudo dpkg -i shellforge_*.deb
```

### macOS (.dmg)

Download the latest `.dmg` from [Releases](../../releases) and open it.

### Build from source

```bash
# Prerequisites: Rust, Node.js 18+, system dependencies for Tauri
npm install
npm run tauri:build
```

## Development

```bash
npm install
npm run tauri:dev
```

## Keyboard shortcuts

Shortcuts are built-in (not user-configurable in settings). On macOS,
**Cmd** is the primary modifier for ShellForge chords; **Ctrl+Shift** chords
still work for parity with Linux. Shell control characters (for example
interrupt with **Ctrl+C**) stay on **Ctrl** on every platform, like other
terminal emulators.

| Action | Linux | macOS |
| --- | --- | --- |
| Copy | Ctrl+Shift+C | Cmd+Shift+C (Ctrl+Shift+C also) |
| Paste | Ctrl+Shift+V | Cmd+Shift+V (Ctrl+Shift+V also) |
| Split vertical | Ctrl+Shift+E | Cmd+Shift+E (Ctrl+Shift+E also) |
| Split horizontal | Ctrl+Shift+O | Cmd+Shift+O (Ctrl+Shift+O also) |
| Close panel | Ctrl+Shift+W | Cmd+Shift+W (Ctrl+Shift+W also) |
| Move between panels | Alt+Arrow keys | Option+Arrow keys |
| New workspace | Ctrl+Shift+T | Cmd+Shift+T (Ctrl+Shift+T also) |
| Close workspace | Ctrl+Shift+Q | Cmd+Shift+Q (Ctrl+Shift+Q also) |

## License

AGPL-3.0 — see [LICENSE](LICENSE)

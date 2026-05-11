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
npm run tauri build
```

## Development

```bash
npm install
npm run tauri dev
```

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Split vertical | Ctrl+Shift+E |
| Split horizontal | Ctrl+Shift+O |
| Close panel | Ctrl+Shift+W |
| Move between panels | Alt+Arrow keys |
| New workspace | Ctrl+Shift+T |
| Close workspace | Ctrl+Shift+Q |

## License

AGPL-3.0 — see [LICENSE](LICENSE)

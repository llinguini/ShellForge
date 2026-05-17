import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal, type IDisposable } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { isAccelShiftChord } from "../lib/accelerators";
import { xtermTheme } from "../lib/tokens";
import "@xterm/xterm/css/xterm.css";

interface PtyOutputPayload {
  id: string;
  data: string;
}

type ClipboardSource = "clipboard" | "primary";
const HISTORY_OSC_PREFIX = "\x1b]777;ShellForgeHistory;";
const OSC_TERMINATOR = "\x07";
const HISTORY_SUGGESTION_LIMIT = 50;
const MULTI_WORD_COMMANDS = new Set([
  "apt",
  "cargo",
  "docker",
  "git",
  "kubectl",
  "npm",
  "systemctl",
  "yarn",
]);

export interface SyntaxTheme {
  command: string;
  subcommand: string;
  flag: string;
  string: string;
  argument: string;
}

export const defaultSyntaxTheme: SyntaxTheme = {
  command: "#89e051",
  subcommand: "#61afef",
  flag: "#e5c07b",
  string: "#e06c75",
  argument: "#abb2bf",
};

type SyntaxTokenType = keyof SyntaxTheme;

interface SyntaxToken {
  text: string;
  type: SyntaxTokenType;
}

interface TerminalProps {
  active: boolean;
  id: string;
  onContextMenu: (id: string, x: number, y: number) => void;
  onFocus: (id: string) => void;
  onTitleChange: (id: string, title: string) => void;
}

interface CachedTerminal {
  clipboardSyncTimer: number | null;
  dataDisposable: IDisposable;
  fitAddon: FitAddon;
  ghostElement: HTMLSpanElement | null;
  historyCwd: string;
  historyRequestId: number;
  inputBuffer: string;
  onTitleChange: ((id: string, title: string) => void) | null;
  pendingOutput: string;
  selectionDisposable: IDisposable;
  suggestion: string | null;
  suggestionIndex: number;
  suggestionList: string[];
  suggestionListCwd: string;
  suggestionListPrefix: string;
  syntaxElement: HTMLDivElement | null;
  terminal: XtermTerminal;
  titleDisposable: IDisposable;
  unlistenPromise: Promise<() => void>;
}

interface XtermWithCore extends XtermTerminal {
  _core?: {
    _renderService?: {
      dimensions?: {
        actualCellHeight?: number;
        actualCellWidth?: number;
      };
    };
  };
}

const terminalCache = new Map<string, CachedTerminal>();

export function disposeTerminal(id: string) {
  const cached = terminalCache.get(id);
  if (!cached) {
    return;
  }

  cached.dataDisposable.dispose();
  cached.selectionDisposable.dispose();
  cached.titleDisposable.dispose();
  if (cached.clipboardSyncTimer !== null) {
    window.clearTimeout(cached.clipboardSyncTimer);
  }
  cached.ghostElement?.remove();
  cached.syntaxElement?.remove();
  cached.terminal.dispose();
  void cached.unlistenPromise.then((unlisten) => unlisten());
  terminalCache.delete(id);
}

export function copyTerminalSelection(id: string) {
  const selection = terminalCache.get(id)?.terminal.getSelection();
  if (selection) {
    void writeClipboard("clipboard", selection);
  }
}

export function pasteClipboardIntoTerminal(id: string) {
  void pasteFromClipboard(id, "clipboard");
}

export function Terminal({
  active,
  id,
  onContextMenu,
  onFocus,
  onTitleChange,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const cached = getOrCreateTerminal(id);
    cached.onTitleChange = onTitleChange;

    attachTerminalElement(cached.terminal, container);
    ensureGhostElement(cached, container);
    ensureSyntaxElement(cached, container);
    terminalRef.current = cached.terminal;
    fitAddonRef.current = cached.fitAddon;

    const resize = (focus = false) => {
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        return;
      }

      cached.fitAddon.fit();

      void invoke("resize_pty", {
        id,
        cols: cached.terminal.cols,
        rows: cached.terminal.rows,
      }).catch((error) => console.error("failed to resize PTY", error));

      cached.terminal.refresh(0, Math.max(0, cached.terminal.rows - 1));
      updateInputOverlays(cached);

      if (focus) {
        cached.terminal.focus();
      }
    };

    const resizeObserver = new ResizeObserver(() => resize());
    const onWindowResize = () => resize();
    resizeObserver.observe(container);
    window.addEventListener("resize", onWindowResize);

    requestAnimationFrame(() => resize());

    return () => {
      cached.onTitleChange = null;
      resizeObserver.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [id, onTitleChange]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const terminal = terminalRef.current;
          if (!terminal) {
            return;
          }

          fitAddonRef.current?.fit();

          void invoke("resize_pty", {
            id,
            cols: terminal.cols,
            rows: terminal.rows,
          }).catch((error) => console.error("failed to resize PTY", error));

          terminal.refresh(0, Math.max(0, terminal.rows - 1));
          updateInputOverlays(terminalCache.get(id));
          terminal.focus();
        });
      });
    }
  }, [active, id]);

  return (
    <div
      className={active ? "terminal-pane terminal-pane-active" : "terminal-pane"}
      data-panel-id={id}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          onFocus(id);
          void pasteFromClipboard(id, "primary");
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onFocus(id);
        onContextMenu(id, event.clientX, event.clientY);
      }}
      onFocusCapture={() => onFocus(id)}
      onMouseDown={() => onFocus(id)}
      ref={containerRef}
    />
  );
}

function getOrCreateTerminal(id: string) {
  const cached = terminalCache.get(id);
  if (cached) {
    return cached;
  }

  const terminal = new XtermTerminal({
    allowProposedApi: false,
    convertEol: true,
    cursorBlink: true,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', monospace",
    fontSize: 13,
    theme: xtermTheme,
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  let entry: CachedTerminal;
  const dataDisposable = terminal.onData((data) => {
    handleTerminalInput(entry, data);

    void invoke("write_to_pty", { id, data }).catch((error) => {
      console.error("failed to write to PTY", error);
    });
  });
  const titleDisposable = terminal.onTitleChange((title) => {
    entry.onTitleChange?.(id, currentDirectoryName(title));
  });
  const selectionDisposable = terminal.onSelectionChange(() => {
    if (entry.clipboardSyncTimer !== null) {
      window.clearTimeout(entry.clipboardSyncTimer);
    }

    entry.clipboardSyncTimer = window.setTimeout(() => {
      const selection = terminal.getSelection();
      if (selection) {
        void writeClipboard("primary", selection);
      }
    }, 50);
  });
  const unlistenPromise = listen<PtyOutputPayload>("pty_output", (event) => {
    if (event.payload.id === id) {
      const output = processPtyOutput(entry, event.payload.data);
      if (output) {
        terminal.write(output, () => updateInputOverlays(entry));
      }
    }
  });

  entry = {
    clipboardSyncTimer: null,
    dataDisposable,
    fitAddon,
    ghostElement: null,
    historyCwd: "",
    historyRequestId: 0,
    inputBuffer: "",
    onTitleChange: null,
    pendingOutput: "",
    selectionDisposable,
    suggestion: null,
    suggestionIndex: 0,
    suggestionList: [],
    suggestionListCwd: "",
    suggestionListPrefix: "",
    syntaxElement: null,
    terminal,
    titleDisposable,
    unlistenPromise,
  };

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") {
      return true;
    }

    if (event.type === "keydown" && event.key === "ArrowUp" && entry.inputBuffer) {
      void moveHistorySuggestion(entry, "older");
      return false;
    }

    if (event.type === "keydown" && event.key === "ArrowDown" && entry.inputBuffer) {
      moveHistorySuggestion(entry, "newer");
      return false;
    }

    if (event.type === "keydown" && event.key === "ArrowRight" && entry.suggestion) {
      const remaining = entry.suggestion.slice(entry.inputBuffer.length);
      if (remaining) {
        entry.inputBuffer = entry.suggestion;
        resetSuggestionNavigation(entry);
        clearSuggestion(entry);
        updateSyntaxOverlay(entry);
        void invoke("write_to_pty", { id, data: remaining }).catch((error) => {
          console.error("failed to accept history suggestion", error);
        });
        return false;
      }
    }

    if (event.type === "keydown" && event.key === "Escape" && entry.suggestion) {
      resetSuggestionNavigation(entry);
      clearSuggestion(entry);
      return false;
    }

    const key = event.key.toLowerCase();
    if (isAccelShiftChord(event)) {
      if (key === "c") {
        const selection = terminal.getSelection();
        if (selection) {
          void writeClipboard("clipboard", selection);
        }
        return false;
      }

      if (key === "v") {
        void pasteFromClipboard(id, "clipboard");
        return false;
      }
    }

    if (isInputAbort(event)) {
      resetInputBuffer(entry);
      return true;
    }

    if (event.key === "Enter") {
      resetInputBuffer(entry);
      return true;
    }

    if (event.key === "Backspace" && isPlainInputKey(event)) {
      removeLastInputCharacter(entry);
      return true;
    }

    if (event.key.length === 1 && isPlainInputKey(event)) {
      appendInputCharacter(entry, event.key);
      return true;
    }

    return true;
  });

  terminalCache.set(id, entry);
  return entry;
}

function attachTerminalElement(terminal: XtermTerminal, container: HTMLElement) {
  if (terminal.element) {
    container.appendChild(terminal.element);
    return;
  }

  terminal.open(container);
}

function handleTerminalInput(cached: CachedTerminal, data: string) {
  if (data === "\r") {
    resetInputBuffer(cached);
    return;
  }

  if (data === "\x03" || data === "\x04") {
    resetInputBuffer(cached);
    return;
  }

  const characters = [...data];
  if (characters.length > 1 && characters.every(isPrintableCharacter)) {
    appendInputCharacter(cached, data);
    return;
  }

  if (data.startsWith("\x1b")) {
    resetSuggestionNavigation(cached);
    clearSuggestion(cached);
    return;
  }
}

function appendInputCharacter(cached: CachedTerminal, character: string) {
  cached.inputBuffer += character;
  resetSuggestionNavigation(cached);
  updateSyntaxOverlay(cached);
  void requestHistorySuggestion(cached);
}

function removeLastInputCharacter(cached: CachedTerminal) {
  if (!cached.inputBuffer) {
    return;
  }

  cached.inputBuffer = [...cached.inputBuffer].slice(0, -1).join("");
  resetSuggestionNavigation(cached);
  updateSyntaxOverlay(cached);
  void requestHistorySuggestion(cached);
}

function resetInputBuffer(cached: CachedTerminal) {
  cached.inputBuffer = "";
  resetSuggestionNavigation(cached);
  clearSuggestion(cached);
  updateSyntaxOverlay(cached);
}

function isPlainInputKey(event: KeyboardEvent) {
  return !event.altKey && !event.ctrlKey && !event.metaKey;
}

function isInputAbort(event: KeyboardEvent) {
  return (
    event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && ["c", "d"].includes(event.key.toLowerCase())
  );
}

function isPrintableCharacter(character: string) {
  return character.length > 0 && !/[\u0000-\u001f\u007f]/.test(character);
}

async function requestHistorySuggestion(cached: CachedTerminal) {
  const prefix = cached.inputBuffer;
  const requestId = cached.historyRequestId + 1;
  cached.historyRequestId = requestId;

  if (!prefix) {
    clearSuggestion(cached);
    return;
  }

  try {
    const suggestion = await invoke<string | null>("get_history_suggestion", {
      cwd: cached.historyCwd,
      prefix,
    });

    if (requestId !== cached.historyRequestId) {
      return;
    }

    cached.suggestion =
      suggestion && suggestion.startsWith(prefix) && suggestion !== prefix ? suggestion : null;
    updateGhostOverlay(cached);
  } catch (error) {
    console.error("failed to get history suggestion", error);
    clearSuggestion(cached);
  }
}

async function moveHistorySuggestion(cached: CachedTerminal, direction: "older" | "newer") {
  const prefix = cached.inputBuffer;
  if (!prefix) {
    return;
  }

  if (direction === "newer") {
    moveToNewerSuggestion(cached);
    return;
  }

  const wasNavigating = cached.suggestion !== null && hasMatchingSuggestionList(cached, prefix);
  const suggestions = await getFilteredHistorySuggestions(cached, prefix);
  if (prefix !== cached.inputBuffer) {
    return;
  }

  if (suggestions.length === 0) {
    clearSuggestion(cached);
    return;
  }

  const nextIndex = wasNavigating
    ? Math.min(cached.suggestionIndex + 1, suggestions.length - 1)
    : 0;
  setSuggestionFromList(cached, nextIndex);
}

function moveToNewerSuggestion(cached: CachedTerminal) {
  if (!cached.suggestion || !hasMatchingSuggestionList(cached, cached.inputBuffer)) {
    cached.suggestionIndex = 0;
    clearSuggestion(cached);
    return;
  }

  if (cached.suggestionIndex <= 0) {
    cached.suggestionIndex = 0;
    clearSuggestion(cached);
    return;
  }

  setSuggestionFromList(cached, cached.suggestionIndex - 1);
}

async function getFilteredHistorySuggestions(cached: CachedTerminal, prefix: string) {
  if (hasMatchingSuggestionList(cached, prefix)) {
    return cached.suggestionList;
  }

  const requestId = cached.historyRequestId + 1;
  cached.historyRequestId = requestId;

  try {
    const suggestions = await invoke<string[]>("get_history_suggestions_filtered", {
      cwd: cached.historyCwd,
      limit: HISTORY_SUGGESTION_LIMIT,
      prefix,
    });

    if (requestId !== cached.historyRequestId || prefix !== cached.inputBuffer) {
      return [];
    }

    cached.suggestionList = suggestions.filter(
      (suggestion) => suggestion.startsWith(prefix) && suggestion !== prefix,
    );
    cached.suggestionListCwd = cached.historyCwd;
    cached.suggestionListPrefix = prefix;
    return cached.suggestionList;
  } catch (error) {
    console.error("failed to get filtered history suggestions", error);
    resetSuggestionNavigation(cached);
    clearSuggestion(cached);
    return [];
  }
}

function hasMatchingSuggestionList(cached: CachedTerminal, prefix: string) {
  return (
    cached.suggestionListPrefix === prefix
    && cached.suggestionListCwd === cached.historyCwd
  );
}

function setSuggestionFromList(cached: CachedTerminal, index: number) {
  const suggestion = cached.suggestionList[index];
  cached.suggestionIndex = suggestion === undefined ? 0 : index;
  cached.suggestion = suggestion ?? null;
  updateGhostOverlay(cached);
}

function resetSuggestionNavigation(cached: CachedTerminal) {
  cached.suggestionIndex = 0;
  cached.suggestionList = [];
  cached.suggestionListCwd = "";
  cached.suggestionListPrefix = "";
}

function clearSuggestion(cached: CachedTerminal) {
  cached.suggestion = null;
  updateGhostOverlay(cached);
}

function updateInputOverlays(cached?: CachedTerminal) {
  updateSyntaxOverlay(cached);
  updateGhostOverlay(cached);
}

function processPtyOutput(cached: CachedTerminal, data: string) {
  let buffer = cached.pendingOutput + data;
  cached.pendingOutput = "";

  let visible = "";
  loop: while (buffer.length > 0) {
    const markerStart = buffer.indexOf(HISTORY_OSC_PREFIX);
    if (markerStart === -1) {
      const partialStart = historyMarkerPartialStart(buffer);
      visible += buffer.slice(0, partialStart);
      cached.pendingOutput = buffer.slice(partialStart);
      break loop;
    }

    visible += buffer.slice(0, markerStart);
    const markerEnd = buffer.indexOf(OSC_TERMINATOR, markerStart);
    if (markerEnd === -1) {
      cached.pendingOutput = buffer.slice(markerStart);
      break loop;
    }

    const payload = buffer.slice(markerStart + HISTORY_OSC_PREFIX.length, markerEnd);
    handleHistoryMarker(cached, payload);
    buffer = buffer.slice(markerEnd + OSC_TERMINATOR.length);
  }

  return visible;
}

function historyMarkerPartialStart(text: string) {
  const start = Math.max(0, text.length - HISTORY_OSC_PREFIX.length + 1);

  for (let index = start; index < text.length; index += 1) {
    if (HISTORY_OSC_PREFIX.startsWith(text.slice(index))) {
      return index;
    }
  }

  return text.length;
}

function handleHistoryMarker(cached: CachedTerminal, payload: string) {
  const [commandBase64, cwdBase64, exitCodeText] = payload.split(";");
  if (commandBase64 === undefined || !cwdBase64 || !exitCodeText) {
    return;
  }

  const command = decodeBase64Text(commandBase64);
  const cwd = decodeBase64Text(cwdBase64);
  const exitCode = Number.parseInt(exitCodeText, 10);
  cached.historyCwd = cwd;

  if (!command || !Number.isFinite(exitCode)) {
    return;
  }

  void invoke("add_history_entry", {
    command,
    cwd,
    exitCode,
  }).catch((error) => console.error("failed to add history entry", error));
}

function decodeBase64Text(value: string) {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function ensureGhostElement(cached: CachedTerminal, container: HTMLElement) {
  if (cached.ghostElement?.isConnected) {
    return;
  }

  const element = document.createElement("span");
  element.className = "terminal-ghost-text";
  cached.ghostElement = element;

  const viewport = cached.terminal.element?.querySelector(".xterm-viewport");
  const parent = viewport?.parentElement ?? cached.terminal.element ?? container;
  if (parent instanceof HTMLElement) {
    parent.style.position = parent.style.position || "relative";
    parent.appendChild(element);
  }
}

function ensureSyntaxElement(cached: CachedTerminal, container: HTMLElement) {
  if (cached.syntaxElement?.isConnected) {
    return;
  }

  const element = document.createElement("div");
  element.className = "terminal-syntax-highlight";
  cached.syntaxElement = element;

  const viewport = cached.terminal.element?.querySelector(".xterm-viewport");
  const parent = viewport?.parentElement ?? cached.terminal.element ?? container;
  if (parent instanceof HTMLElement) {
    parent.style.position = parent.style.position || "relative";
    parent.appendChild(element);
  }
}

function updateSyntaxOverlay(cached?: CachedTerminal) {
  if (!cached?.syntaxElement) {
    return;
  }

  if (!cached.inputBuffer) {
    cached.syntaxElement.replaceChildren();
    cached.syntaxElement.style.display = "none";
    return;
  }

  const metrics = cellMetrics(cached.terminal);
  const terminalElement = cached.terminal.element;
  const screen = terminalElement?.querySelector(".xterm-screen");
  const parent = cached.syntaxElement.parentElement;
  if (!metrics || !terminalElement || !(screen instanceof HTMLElement) || !parent) {
    cached.syntaxElement.style.display = "none";
    return;
  }

  const position = inputStartPosition(cached);
  if (!position) {
    cached.syntaxElement.style.display = "none";
    return;
  }

  const parentRect = parent.getBoundingClientRect();
  const screenRect = screen.getBoundingClientRect();
  const left = screenRect.left - parentRect.left + position.column * metrics.width;
  const top = screenRect.top - parentRect.top + position.row * metrics.height;

  cached.syntaxElement.replaceChildren(...syntaxTokenElements(cached.inputBuffer));
  cached.syntaxElement.style.display = "block";
  cached.syntaxElement.style.left = `${left}px`;
  cached.syntaxElement.style.lineHeight = `${metrics.height}px`;
  cached.syntaxElement.style.minHeight = `${metrics.height}px`;
  cached.syntaxElement.style.top = `${top}px`;
  cached.syntaxElement.style.width =
    `${inputCellLength(cached.inputBuffer) * metrics.width}px`;
}

function updateGhostOverlay(cached?: CachedTerminal) {
  if (!cached?.ghostElement) {
    return;
  }

  const suffix = cached.suggestion?.slice(cached.inputBuffer.length) ?? "";
  if (!suffix) {
    cached.ghostElement.textContent = "";
    cached.ghostElement.style.display = "none";
    return;
  }

  const metrics = cellMetrics(cached.terminal);
  const terminalElement = cached.terminal.element;
  const screen = terminalElement?.querySelector(".xterm-screen");
  const parent = cached.ghostElement.parentElement;
  if (!metrics || !terminalElement || !(screen instanceof HTMLElement) || !parent) {
    cached.ghostElement.style.display = "none";
    return;
  }

  const parentRect = parent.getBoundingClientRect();
  const screenRect = screen.getBoundingClientRect();
  const buffer = cached.terminal.buffer.active;
  const left = screenRect.left - parentRect.left + buffer.cursorX * metrics.width;
  const top = screenRect.top - parentRect.top + buffer.cursorY * metrics.height;

  cached.ghostElement.textContent = suffix;
  cached.ghostElement.style.display = "block";
  cached.ghostElement.style.left = `${left}px`;
  cached.ghostElement.style.lineHeight = `${metrics.height}px`;
  cached.ghostElement.style.top = `${top}px`;
}

function cellMetrics(terminal: XtermTerminal) {
  const dimensions = (terminal as XtermWithCore)._core?._renderService?.dimensions;
  const width = dimensions?.actualCellWidth;
  const height = dimensions?.actualCellHeight;

  if (width && height) {
    return { height, width };
  }

  const element = terminal.element;
  if (!element) {
    return null;
  }

  return {
    height: element.clientHeight / Math.max(1, terminal.rows),
    width: element.clientWidth / Math.max(1, terminal.cols),
  };
}

function inputStartPosition(cached: CachedTerminal) {
  const buffer = cached.terminal.buffer.active;
  let column = buffer.cursorX - inputCellLength(cached.inputBuffer);
  let row = buffer.cursorY;

  while (column < 0) {
    column += cached.terminal.cols;
    row -= 1;
  }

  if (row < 0) {
    return null;
  }

  return { column, row };
}

function inputCellLength(value: string) {
  return [...value].length;
}

function syntaxTokenElements(input: string) {
  return tokenizeSyntax(input).map((token) => {
    const element = document.createElement("span");
    element.textContent = token.text;
    element.style.color = defaultSyntaxTheme[token.type];
    return element;
  });
}

function tokenizeSyntax(input: string): SyntaxToken[] {
  const parts = input.split(/( +)/);
  const tokens: SyntaxToken[] = [];
  let command = "";
  let tokenIndex = 0;
  let activeQuote: "'" | "\"" | null = null;

  for (const part of parts) {
    if (!part) {
      continue;
    }

    if (/^ +$/.test(part)) {
      tokens.push({ text: part, type: "argument" });
      continue;
    }

    const type = syntaxTokenType(part, tokenIndex, command, activeQuote);
    tokens.push({ text: part, type });

    if (tokenIndex === 0) {
      command = part;
    }

    activeQuote = nextQuoteState(part, activeQuote);
    tokenIndex += 1;
  }

  return tokens;
}

function syntaxTokenType(
  token: string,
  tokenIndex: number,
  command: string,
  activeQuote: "'" | "\"" | null,
): SyntaxTokenType {
  if (tokenIndex === 0) {
    return "command";
  }

  if (activeQuote || token.startsWith("\"") || token.startsWith("'")) {
    return "string";
  }

  if (token.startsWith("-")) {
    return "flag";
  }

  if (tokenIndex === 1 && MULTI_WORD_COMMANDS.has(command)) {
    return "subcommand";
  }

  return "argument";
}

function nextQuoteState(token: string, activeQuote: "'" | "\"" | null) {
  let quote = activeQuote;

  for (const character of token) {
    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
    }
  }

  return quote;
}

function currentDirectoryName(title: string) {
  const trimmed = title.trim();
  if (!trimmed) {
    return "Terminal";
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  const parts = withoutTrailingSlash.split("/").filter(Boolean);

  if (parts.length === 0) {
    return "/";
  }

  return parts[parts.length - 1] ?? "Terminal";
}

async function pasteFromClipboard(id: string, source: ClipboardSource) {
  try {
    const text = await readClipboard(source);
    if (text) {
      await invoke("write_to_pty", { id, data: text });
    }
  } catch (error) {
    console.error(`failed to paste ${source}`, error);
  }
}

async function readClipboard(source: ClipboardSource) {
  try {
    return await invoke<string>("read_clipboard_text", { source });
  } catch (error) {
    if (source === "clipboard" && navigator.clipboard) {
      return navigator.clipboard.readText();
    }

    throw error;
  }
}

async function writeClipboard(source: ClipboardSource, text: string) {
  try {
    await invoke("write_clipboard_text", { source, text });
  } catch (error) {
    if (source === "clipboard" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }

    console.error(`failed to write ${source}`, error);
  }
}

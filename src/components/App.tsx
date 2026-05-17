import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ITheme } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { formatAccelShiftLetter, isAccelShiftChord } from "../lib/accelerators";
import { sf, xtermTheme as defaultXtermTheme } from "../lib/tokens";
import { LoginModal } from "./LoginModal";
import { SettingsModal } from "./SettingsModal";
import { PanelTree } from "./PanelTree";
import { TabBar } from "./TabBar";
import {
  copyTerminalSelection,
  defaultSyntaxTheme,
  disposeTerminal,
  pasteClipboardIntoTerminal,
  type SyntaxTheme,
  type TerminalHandle,
} from "./Terminal";
import {
  closePanel as closePanelNode,
  collectPanelIds,
  firstPanelId,
  splitPanel,
  updateSplitRatio,
  type SplitDirection,
  type Workspace,
} from "./workspaceTree";

interface CreatedPty {
  id: string;
}

interface CredentialsStatus {
  configured: boolean;
}

interface AliasState {
  name: string;
  command: string;
}

interface CommandState {
  name: string;
  script: string;
  description: string;
}

interface InitialProfile {
  active_theme: unknown;
  aliases: Array<{ command: string; id: string; name: string }>;
  commands: Array<{ description: string; id: string; name: string; script: string }>;
}

type JsonObject = Record<string, unknown>;

interface ContextMenuState {
  panelId: string;
  x: number;
  y: number;
}

export function App() {
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [credentialsChecked, setCredentialsChecked] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [activeAliases, setActiveAliases] = useState<Map<string, AliasState>>(new Map());
  const [activeCommands, setActiveCommands] = useState<Map<string, CommandState>>(new Map());
  const [activeXtermTheme, setActiveXtermTheme] = useState<ITheme>({ ...defaultXtermTheme });
  const [activeSyntaxTheme, setActiveSyntaxTheme] =
    useState<SyntaxTheme>(defaultSyntaxTheme);
  const nextWorkspaceNumber = useRef(1);
  const terminalRefs = useRef(new Map<string, RefObject<TerminalHandle | null>>());

  const createPty = useCallback(() => invoke<CreatedPty>("create_pty"), []);

  const registerTerminal = useCallback(
    (panelId: string, ref: RefObject<TerminalHandle | null>) => {
      terminalRefs.current.set(panelId, ref);
    },
    [],
  );

  const unregisterTerminal = useCallback((panelId: string) => {
    terminalRefs.current.delete(panelId);
  }, []);

  const applyThemeToAllTerminals = useCallback((theme: ITheme, syntaxTheme: SyntaxTheme) => {
    setActiveXtermTheme(theme);
    setActiveSyntaxTheme(syntaxTheme);

    for (const terminalRef of terminalRefs.current.values()) {
      terminalRef.current?.applyTheme(theme);
      terminalRef.current?.applySyntaxTheme(syntaxTheme);
    }
  }, []);

  const rebuildBashInit = useCallback(
    (aliases: Map<string, AliasState>, commands: Map<string, CommandState>) => {
      void invoke("rebuild_bash_init", {
        aliases: Array.from(aliases.values()),
        commands: Array.from(commands.values()).map(({ name, script }) => ({
          name,
          script,
        })),
      }).catch((error) => console.error("failed to rebuild bash init", error));
    },
    [],
  );

  const applyThemeFromPayload = useCallback(
    (payload: JsonObject) => {
      if (payload.is_active !== true) {
        return;
      }

      const colors = asObject(payload.colors);
      const background = stringOr(colors?.bg, defaultXtermTheme.background ?? sf.colors.bg);
      const foreground = stringOr(colors?.fg, defaultXtermTheme.foreground ?? sf.colors.text);

      const theme: ITheme = {
        background,
        foreground,
        cursor: foreground,
        cursorAccent: background,
        selectionBackground: sf.colors.b1,
      };

      const syntaxTheme: SyntaxTheme = {
        ...defaultSyntaxTheme,
        argument: foreground,
        command: stringOr(colors?.accent, defaultSyntaxTheme.command),
      };

      applyThemeToAllTerminals(theme, syntaxTheme);
    },
    [applyThemeToAllTerminals],
  );

  const handleSocketMessage = useCallback(
    (message: unknown) => {
      const envelope = asObject(message);
      if (!envelope) {
        return;
      }

      const type = typeof envelope.type === "string" ? envelope.type : "";
      const payload = asObject(envelope.payload) ?? envelope;

      switch (type) {
        case "theme.updated":
          applyThemeFromPayload(payload);
          break;
        case "alias.updated": {
          const id = stringOr(payload.id);
          if (!id) {
            break;
          }

          setActiveAliases((current) => {
            const next = new Map(current);
            next.set(id, {
              name: stringOr(payload.name),
              command: stringOr(payload.command),
            });
            return next;
          });
          break;
        }
        case "alias.deleted": {
          const id = stringOr(payload.id);
          if (!id) {
            break;
          }

          setActiveAliases((current) => {
            const next = new Map(current);
            next.delete(id);
            return next;
          });
          break;
        }
        case "command.updated": {
          const id = stringOr(payload.id);
          if (!id) {
            break;
          }

          setActiveCommands((current) => {
            const next = new Map(current);
            next.set(id, {
              name: stringOr(payload.name),
              script: stringOr(payload.script),
              description: stringOr(payload.description),
            });
            return next;
          });
          break;
        }
        case "command.deleted": {
          const id = stringOr(payload.id);
          if (!id) {
            break;
          }

          setActiveCommands((current) => {
            const next = new Map(current);
            next.delete(id);
            return next;
          });
          break;
        }
        default:
          break;
      }
    },
    [applyThemeFromPayload],
  );

  const createWorkspace = useCallback(() => {
    void createPty()
      .then((created) => {
        const title = `Workspace ${nextWorkspaceNumber.current}`;
        nextWorkspaceNumber.current += 1;

        const workspace: Workspace = {
          id: crypto.randomUUID(),
          title,
          root: { kind: "leaf", id: created.id },
        };

        setWorkspaces((currentWorkspaces) => [...currentWorkspaces, workspace]);
        setActiveWorkspaceId(workspace.id);
        setActivePanelId(created.id);
      })
      .catch((error) => console.error("failed to create workspace", error));
  }, [createPty]);

  const renameWorkspace = useCallback((workspaceId: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return;
    }

    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, title: trimmedTitle } : workspace,
      ),
    );
  }, []);

  const closeWorkspace = useCallback(
    (workspaceId: string | null = activeWorkspaceId) => {
      if (!workspaceId) {
        return;
      }

      const workspaceIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);
      const workspace = workspaces[workspaceIndex];
      if (!workspace) {
        return;
      }

      for (const panelId of collectPanelIds(workspace.root)) {
        disposeTerminal(panelId);
        void invoke("close_pty", { id: panelId }).catch((error) => {
          console.error("failed to close PTY", error);
        });
      }

      const nextWorkspaces = workspaces.filter((item) => item.id !== workspaceId);

      if (workspaceId !== activeWorkspaceId) {
        setWorkspaces(nextWorkspaces);
        return;
      }

      const nextWorkspace =
        nextWorkspaces[Math.min(workspaceIndex, nextWorkspaces.length - 1)] ?? null;

      setWorkspaces(nextWorkspaces);
      setActiveWorkspaceId(nextWorkspace?.id ?? null);
      setActivePanelId(nextWorkspace ? firstPanelId(nextWorkspace.root) : null);
    },
    [activeWorkspaceId, workspaces],
  );

  const splitPanelById = useCallback(
    (panelId: string | null, direction: SplitDirection) => {
      if (!panelId) {
        return;
      }

      const workspace = workspaces.find((item) => collectPanelIds(item.root).includes(panelId));
      if (!workspace) {
        return;
      }

      void createPty()
        .then((created) => {
          setWorkspaces((currentWorkspaces) =>
            currentWorkspaces.map((item) =>
              item.id === workspace.id
                ? {
                    ...item,
                    root: splitPanel(item.root, panelId, direction, created.id),
                  }
                : item,
            ),
          );
          setActiveWorkspaceId(workspace.id);
          setActivePanelId(created.id);
        })
        .catch((error) => console.error("failed to split panel", error));
    },
    [createPty, workspaces],
  );

  const closePanelById = useCallback(
    (panelId: string | null = activePanelId) => {
      if (!panelId) {
        return;
      }

      const workspaceIndex = workspaces.findIndex((workspace) =>
        collectPanelIds(workspace.root).includes(panelId),
      );
      const workspace = workspaces[workspaceIndex];
      if (!workspace) {
        return;
      }

      const nextRoot = closePanelNode(workspace.root, panelId);
      disposeTerminal(panelId);
      void invoke("close_pty", { id: panelId }).catch((error) => {
        console.error("failed to close PTY", error);
      });

      if (!nextRoot) {
        const nextWorkspaces = workspaces.filter((item) => item.id !== workspace.id);
        const nextWorkspace =
          nextWorkspaces[Math.min(workspaceIndex, nextWorkspaces.length - 1)] ?? null;

        setWorkspaces(nextWorkspaces);
        setActiveWorkspaceId(nextWorkspace?.id ?? null);
        setActivePanelId(nextWorkspace ? firstPanelId(nextWorkspace.root) : null);
        return;
      }

      setWorkspaces((currentWorkspaces) =>
        currentWorkspaces.map((item) =>
          item.id === workspace.id ? { ...item, root: nextRoot } : item,
        ),
      );

      if (activePanelId === panelId) {
        setActivePanelId(firstPanelId(nextRoot));
      }
    },
    [activePanelId, workspaces],
  );

  const resizeSplit = useCallback(
    (path: string, ratio: number) => {
      if (!activeWorkspaceId) {
        return;
      }

      setWorkspaces((currentWorkspaces) =>
        currentWorkspaces.map((workspace) =>
          workspace.id === activeWorkspaceId
            ? { ...workspace, root: updateSplitRatio(workspace.root, path, ratio) }
            : workspace,
        ),
      );
    },
    [activeWorkspaceId],
  );

  const ignoreTerminalTitle = useCallback(() => undefined, []);

  const focusPanel = useCallback(
    (panelId: string) => {
      const workspace = workspaces.find((item) => collectPanelIds(item.root).includes(panelId));
      if (workspace) {
        setActiveWorkspaceId(workspace.id);
      }

      setActivePanelId(panelId);
    },
    [workspaces],
  );

  const focusPanelByDirection = useCallback((key: string) => {
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>(".workspace-view-active [data-panel-id]"),
    );
    const active = panels.find((panel) => panel.dataset.panelId === activePanelId);
    if (!active) {
      return;
    }

    const activeRect = active.getBoundingClientRect();
    const activeCenter = centerOf(activeRect);
    const candidates = panels
      .filter((panel) => panel !== active)
      .map((panel) => ({
        id: panel.dataset.panelId,
        rect: panel.getBoundingClientRect(),
      }))
      .filter((panel): panel is { id: string; rect: DOMRect } => Boolean(panel.id))
      .filter((panel) => isInDirection(activeCenter, centerOf(panel.rect), key))
      .sort((left, right) => {
        const leftScore = directionScore(activeCenter, centerOf(left.rect), key);
        const rightScore = directionScore(activeCenter, centerOf(right.rect), key);
        return leftScore - rightScore;
      });

    const nextPanelId = candidates[0]?.id;
    if (nextPanelId) {
      setActivePanelId(nextPanelId);
    }
  }, [activePanelId]);

  const openContextMenu = useCallback((panelId: string, x: number, y: number) => {
    setActivePanelId(panelId);
    setContextMenu({ panelId, x, y });
  }, []);

  const openSettings = useCallback(() => {
    setContextMenu(null);
    setShowSettingsModal(true);
  }, []);

  const handleLogout = useCallback(() => {
    setShowSettingsModal(false);
    setShowLoginModal(true);
  }, []);

  useEffect(() => {
    void invoke<CredentialsStatus>("check_credentials")
      .then((status) => {
        if (!status.configured) {
          setShowLoginModal(true);
        }
      })
      .catch((error) => {
        console.error("failed to check credentials", error);
        setShowLoginModal(true);
      })
      .finally(() => {
        setCredentialsChecked(true);
      });
  }, []);

  useEffect(() => {
    void invoke<InitialProfile>("load_initial_profile")
      .then((profile) => {
        const aliases = new Map(
          profile.aliases.map((alias) => [
            alias.id,
            { name: alias.name, command: alias.command },
          ]),
        );
        const commands = new Map(
          profile.commands.map((command) => [
            command.id,
            {
              name: command.name,
              script: command.script,
              description: command.description ?? "",
            },
          ]),
        );

        setActiveAliases(aliases);
        setActiveCommands(commands);

        if (profile.active_theme) {
          applyThemeFromPayload(asObject(profile.active_theme) ?? {});
        }
      })
      .catch((error) => {
        console.error("failed to load initial profile", error);
      })
      .finally(() => {
        setProfileLoaded(true);
      });
  }, [applyThemeFromPayload, rebuildBashInit]);

  useEffect(() => {
    if (!profileLoaded) {
      return;
    }

    rebuildBashInit(activeAliases, activeCommands);
  }, [activeAliases, activeCommands, profileLoaded, rebuildBashInit]);

  useEffect(() => {
    if (!credentialsChecked || !profileLoaded) {
      return;
    }

    createWorkspace();
  }, [createWorkspace, credentialsChecked, profileLoaded]);

  useEffect(() => {
    const unlisten = listen<unknown>("socket_message", (event) => {
      handleSocketMessage(event.payload);
    });

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [handleSocketMessage]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const chordKey = event.key.toLowerCase();
      if (isAccelShiftChord(event) && chordKey === "e") {
        event.preventDefault();
        splitPanelById(activePanelId, "vertical");
      } else if (isAccelShiftChord(event) && chordKey === "o") {
        event.preventDefault();
        splitPanelById(activePanelId, "horizontal");
      } else if (isAccelShiftChord(event) && chordKey === "w") {
        event.preventDefault();
        closePanelById(activePanelId);
      } else if (isAccelShiftChord(event) && chordKey === "t") {
        event.preventDefault();
        createWorkspace();
      } else if (isAccelShiftChord(event) && chordKey === "q") {
        event.preventDefault();
        closeWorkspace();
      } else if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === ",") {
        event.preventDefault();
        openSettings();
      } else if (event.altKey && event.key.startsWith("Arrow")) {
        event.preventDefault();
        focusPanelByDirection(event.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activePanelId,
    closePanelById,
    closeWorkspace,
    createWorkspace,
    focusPanelByDirection,
    openSettings,
    splitPanelById,
  ]);

  return (
    <main className="app-shell">
      <TabBar
        activeId={activeWorkspaceId}
        onClose={closeWorkspace}
        onCreate={createWorkspace}
        onOpenSettings={openSettings}
        onRename={renameWorkspace}
        onSelect={(workspaceId) => {
          const workspace = workspaces.find((item) => item.id === workspaceId);
          setActiveWorkspaceId(workspaceId);
          setActivePanelId(workspace ? firstPanelId(workspace.root) : null);
        }}
        tabs={workspaces}
      />
      <section className="workspace-stack">
        {workspaces.map((workspace) => (
          <div
            className={
              workspace.id === activeWorkspaceId
                ? "workspace-view workspace-view-active"
                : "workspace-view"
            }
            key={workspace.id}
          >
            <PanelTree
              activePanelId={activePanelId}
              node={workspace.root}
              onContextMenu={openContextMenu}
              onFocusPanel={focusPanel}
              onRegisterTerminal={registerTerminal}
              onResizeSplit={resizeSplit}
              onTitleChange={ignoreTerminalTitle}
              onUnregisterTerminal={unregisterTerminal}
              syntaxTheme={activeSyntaxTheme}
              xtermTheme={activeXtermTheme}
            />
          </div>
        ))}
      </section>
      {showLoginModal ? <LoginModal onClose={() => setShowLoginModal(false)} /> : null}
      {showSettingsModal ? (
        <SettingsModal onClose={() => setShowSettingsModal(false)} onLogout={handleLogout} />
      ) : null}
      {contextMenu ? (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button type="button" onClick={() => copyTerminalSelection(contextMenu.panelId)}>
            <span>Copy</span>
            <span className="context-menu-shortcut">{formatAccelShiftLetter("C")}</span>
          </button>
          <button type="button" onClick={() => pasteClipboardIntoTerminal(contextMenu.panelId)}>
            <span>Paste</span>
            <span className="context-menu-shortcut">{formatAccelShiftLetter("V")}</span>
          </button>
          <div className="context-menu-divider" />
          <button type="button" onClick={openSettings}>
            <span>Settings</span>
          </button>
          <div className="context-menu-divider" />
          <button type="button" onClick={() => splitPanelById(contextMenu.panelId, "vertical")}>
            <span>Split vertical</span>
            <span className="context-menu-shortcut">{formatAccelShiftLetter("E")}</span>
          </button>
          <button type="button" onClick={() => splitPanelById(contextMenu.panelId, "horizontal")}>
            <span>Split horizontal</span>
            <span className="context-menu-shortcut">{formatAccelShiftLetter("O")}</span>
          </button>
          <button type="button" onClick={() => closePanelById(contextMenu.panelId)}>
            <span>Close panel</span>
            <span className="context-menu-shortcut">{formatAccelShiftLetter("W")}</span>
          </button>
          <div className="context-menu-divider" />
          <button type="button" onClick={createWorkspace}>
            <span>New workspace</span>
            <span className="context-menu-shortcut">{formatAccelShiftLetter("T")}</span>
          </button>
          <button type="button" onClick={() => closeWorkspace()}>
            <span>Close workspace</span>
            <span className="context-menu-shortcut">{formatAccelShiftLetter("Q")}</span>
          </button>
        </div>
      ) : null}
    </main>
  );
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonObject;
}

function stringOr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function centerOf(rect: DOMRect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function isInDirection(
  source: { x: number; y: number },
  target: { x: number; y: number },
  key: string,
) {
  if (key === "ArrowLeft") {
    return target.x < source.x;
  }

  if (key === "ArrowRight") {
    return target.x > source.x;
  }

  if (key === "ArrowUp") {
    return target.y < source.y;
  }

  if (key === "ArrowDown") {
    return target.y > source.y;
  }

  return false;
}

function directionScore(
  source: { x: number; y: number },
  target: { x: number; y: number },
  key: string,
) {
  const dx = Math.abs(target.x - source.x);
  const dy = Math.abs(target.y - source.y);

  if (key === "ArrowLeft" || key === "ArrowRight") {
    return dx * 2 + dy;
  }

  return dy * 2 + dx;
}

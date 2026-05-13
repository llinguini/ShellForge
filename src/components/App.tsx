import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatAccelShiftLetter, isAccelShiftChord } from "../lib/accelerators";
import { PanelTree } from "./PanelTree";
import { TabBar } from "./TabBar";
import { copyTerminalSelection, disposeTerminal, pasteClipboardIntoTerminal } from "./Terminal";
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
  const nextWorkspaceNumber = useRef(1);

  const createPty = useCallback(() => invoke<CreatedPty>("create_pty"), []);

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

  useEffect(() => {
    createWorkspace();
  }, [createWorkspace]);

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
    splitPanelById,
  ]);

  return (
    <main className="app-shell">
      <TabBar
        activeId={activeWorkspaceId}
        onClose={closeWorkspace}
        onCreate={createWorkspace}
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
              onResizeSplit={resizeSplit}
              onTitleChange={ignoreTerminalTitle}
            />
          </div>
        ))}
      </section>
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

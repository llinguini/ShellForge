import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import type { ITheme } from "@xterm/xterm";
import { Terminal, type SyntaxTheme, type TerminalHandle } from "./Terminal";
import { clampSplitRatio, type PanelNode } from "./workspaceTree";

interface PanelTreeProps {
  activePanelId: string | null;
  node: PanelNode;
  onContextMenu: (panelId: string, x: number, y: number) => void;
  onFocusPanel: (panelId: string) => void;
  onRegisterTerminal: (panelId: string, ref: RefObject<TerminalHandle | null>) => void;
  onResizeSplit: (path: string, ratio: number) => void;
  onTitleChange: (panelId: string, title: string) => void;
  onUnregisterTerminal: (panelId: string) => void;
  syntaxTheme: SyntaxTheme;
  xtermTheme: ITheme;
  path?: string;
}

function PanelLeaf({
  activePanelId,
  node,
  onContextMenu,
  onFocusPanel,
  onRegisterTerminal,
  onTitleChange,
  onUnregisterTerminal,
  syntaxTheme,
  xtermTheme,
}: Omit<PanelTreeProps, "node" | "path" | "onResizeSplit"> & { node: Extract<PanelNode, { kind: "leaf" }> }) {
  const terminalRef = useRef<TerminalHandle>(null);

  useEffect(() => {
    onRegisterTerminal(node.id, terminalRef);
    return () => {
      onUnregisterTerminal(node.id);
    };
  }, [node.id, onRegisterTerminal, onUnregisterTerminal]);

  return (
    <Terminal
      active={node.id === activePanelId}
      id={node.id}
      onContextMenu={onContextMenu}
      onFocus={onFocusPanel}
      onTitleChange={onTitleChange}
      ref={terminalRef}
      syntaxTheme={syntaxTheme}
      xtermTheme={xtermTheme}
    />
  );
}

export function PanelTree({
  activePanelId,
  node,
  onContextMenu,
  onFocusPanel,
  onRegisterTerminal,
  onResizeSplit,
  onTitleChange,
  onUnregisterTerminal,
  syntaxTheme,
  xtermTheme,
  path = "",
}: PanelTreeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  if (node.kind === "leaf") {
    return (
      <PanelLeaf
        activePanelId={activePanelId}
        node={node}
        onContextMenu={onContextMenu}
        onFocusPanel={onFocusPanel}
        onRegisterTerminal={onRegisterTerminal}
        onTitleChange={onTitleChange}
        onUnregisterTerminal={onUnregisterTerminal}
        syntaxTheme={syntaxTheme}
        xtermTheme={xtermTheme}
      />
    );
  }

  const isVertical = node.direction === "vertical";
  const firstPath = childPath(path, "first");
  const secondPath = childPath(path, "second");

  const startResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateRatio = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      const size = isVertical ? rect.width : rect.height;
      const offset = isVertical ? clientX - rect.left : clientY - rect.top;

      if (size <= 0) {
        return;
      }

      onResizeSplit(path, clampSplitRatio(offset / size));
    };

    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      updateRatio(moveEvent.clientX, moveEvent.clientY);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      className={isVertical ? "panel-split panel-split-vertical" : "panel-split"}
      ref={containerRef}
    >
      <div className="panel-branch" style={{ flexGrow: node.ratio }}>
        <PanelTree
          activePanelId={activePanelId}
          node={node.first}
          onContextMenu={onContextMenu}
          onFocusPanel={onFocusPanel}
          onRegisterTerminal={onRegisterTerminal}
          onResizeSplit={onResizeSplit}
          onTitleChange={onTitleChange}
          onUnregisterTerminal={onUnregisterTerminal}
          syntaxTheme={syntaxTheme}
          xtermTheme={xtermTheme}
          path={firstPath}
        />
      </div>
      <div
        className={isVertical ? "panel-divider panel-divider-vertical" : "panel-divider"}
        onMouseDown={startResize}
        role="separator"
      />
      <div className="panel-branch" style={{ flexGrow: 1 - node.ratio }}>
        <PanelTree
          activePanelId={activePanelId}
          node={node.second}
          onContextMenu={onContextMenu}
          onFocusPanel={onFocusPanel}
          onRegisterTerminal={onRegisterTerminal}
          onResizeSplit={onResizeSplit}
          onTitleChange={onTitleChange}
          onUnregisterTerminal={onUnregisterTerminal}
          syntaxTheme={syntaxTheme}
          xtermTheme={xtermTheme}
          path={secondPath}
        />
      </div>
    </div>
  );
}

function childPath(path: string, child: "first" | "second") {
  return path ? `${path}.${child}` : child;
}

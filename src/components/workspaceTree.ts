export type SplitDirection = "horizontal" | "vertical";

export type PanelNode =
  | { kind: "leaf"; id: string }
  | {
      kind: "split";
      direction: SplitDirection;
      ratio: number;
      first: PanelNode;
      second: PanelNode;
    };

export interface Workspace {
  id: string;
  title: string;
  root: PanelNode;
}

export const DEFAULT_SPLIT_RATIO = 0.5;
export const MIN_SPLIT_RATIO = 0.1;
export const MAX_SPLIT_RATIO = 0.9;

export function clampSplitRatio(ratio: number) {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export function collectPanelIds(node: PanelNode): string[] {
  if (node.kind === "leaf") {
    return [node.id];
  }

  return [...collectPanelIds(node.first), ...collectPanelIds(node.second)];
}

export function firstPanelId(node: PanelNode) {
  return collectPanelIds(node)[0] ?? null;
}

export function splitPanel(
  node: PanelNode,
  panelId: string,
  direction: SplitDirection,
  newPanelId: string,
): PanelNode {
  if (node.kind === "leaf") {
    if (node.id !== panelId) {
      return node;
    }

    return {
      kind: "split",
      direction,
      ratio: DEFAULT_SPLIT_RATIO,
      first: node,
      second: { kind: "leaf", id: newPanelId },
    };
  }

  return {
    ...node,
    first: splitPanel(node.first, panelId, direction, newPanelId),
    second: splitPanel(node.second, panelId, direction, newPanelId),
  };
}

export function closePanel(node: PanelNode, panelId: string): PanelNode | null {
  if (node.kind === "leaf") {
    return node.id === panelId ? null : node;
  }

  const first = closePanel(node.first, panelId);
  const second = closePanel(node.second, panelId);

  if (!first && !second) {
    return null;
  }

  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  return {
    ...node,
    first,
    second,
  };
}

export function updateSplitRatio(
  node: PanelNode,
  path: string,
  ratio: number,
): PanelNode {
  if (node.kind === "leaf") {
    return node;
  }

  if (path === "") {
    return {
      ...node,
      ratio: clampSplitRatio(ratio),
    };
  }

  const [next, ...rest] = path.split(".");
  const nextPath = rest.join(".");

  if (next === "first") {
    return {
      ...node,
      first: updateSplitRatio(node.first, nextPath, ratio),
    };
  }

  if (next === "second") {
    return {
      ...node,
      second: updateSplitRatio(node.second, nextPath, ratio),
    };
  }

  return node;
}

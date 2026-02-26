import { layout as dagreLayout } from 'dagre-d3-es/src/dagre/layout.js';
import { Graph } from 'dagre-d3-es/src/graphlib/graph.js';
import type { StateNode, TransitionEdge } from '../types/machine';

const CANVAS_RANKSEP = 110;
const CANVAS_NODESEP = 70;
const PARENT_PADDING_X = 28;
const PARENT_PADDING_Y = 44;

function getNodeSize(node: StateNode): { width: number; height: number } {
  const kind = node.data.kind;
  const width = typeof node.style?.width === 'number' ? node.style.width : undefined;
  const height = typeof node.style?.height === 'number' ? node.style.height : undefined;

  if (width && height) {
    return { width, height };
  }

  if (kind === 'initial') {
    return { width: 40, height: 40 };
  }

  if (kind === 'final') {
    return { width: 54, height: 54 };
  }

  if (kind === 'parallel') {
    return { width: 320, height: 220 };
  }

  return { width: 180, height: 86 };
}

function groupNodesByParent(nodes: StateNode[]): Map<string | null, StateNode[]> {
  const groups = new Map<string | null, StateNode[]>();

  for (const node of nodes) {
    const parentId = node.parentNode ?? null;
    const existing = groups.get(parentId) ?? [];
    existing.push(node);
    groups.set(parentId, existing);
  }

  return groups;
}

function groupDepth(parentId: string | null, nodeById: Map<string, StateNode>): number {
  if (parentId === null) {
    return 0;
  }

  let depth = 1;
  let current = nodeById.get(parentId)?.parentNode;

  while (current) {
    depth += 1;
    current = nodeById.get(current)?.parentNode;
  }

  return depth;
}

function layoutGroup(nodes: StateNode[], edges: TransitionEdge[], isChildGroup: boolean): StateNode[] {
  if (nodes.length <= 1) {
    return nodes;
  }

  const graph = new Graph({ multigraph: true, compound: false });
  graph.setGraph({
    rankdir: 'LR',
    ranksep: CANVAS_RANKSEP,
    nodesep: CANVAS_NODESEP,
    marginx: 24,
    marginy: 24,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const node of nodes) {
    const { width, height } = getNodeSize(node);
    graph.setNode(node.id, { width, height });
  }

  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagreLayout(graph, {});

  return nodes.map((node, index) => {
    const { width, height } = getNodeSize(node);
    const positioned = graph.node(node.id);

    if (!positioned) {
      const row = Math.floor(index / 4);
      const col = index % 4;
      return {
        ...node,
        position: {
          x: col * 220 + (isChildGroup ? PARENT_PADDING_X : 40),
          y: row * 150 + (isChildGroup ? PARENT_PADDING_Y : 40),
        },
      };
    }

    return {
      ...node,
      position: {
        x: positioned.x - width / 2 + (isChildGroup ? PARENT_PADDING_X : 0),
        y: positioned.y - height / 2 + (isChildGroup ? PARENT_PADDING_Y : 0),
      },
    };
  });
}

function normalizeParentBounds(nodes: StateNode[]): StateNode[] {
  const nextNodes = nodes.map((node) => ({ ...node }));
  const byId = new Map(nextNodes.map((node) => [node.id, node]));
  const parents = nextNodes
    .filter((node) => nextNodes.some((child) => child.parentNode === node.id))
    .sort((a, b) => groupDepth(b.id, byId) - groupDepth(a.id, byId));

  for (const parent of parents) {
    const children = nextNodes.filter((node) => node.parentNode === parent.id);

    if (children.length === 0) {
      continue;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const child of children) {
      const { width, height } = getNodeSize(child);
      minX = Math.min(minX, child.position.x);
      minY = Math.min(minY, child.position.y);
      maxX = Math.max(maxX, child.position.x + width);
      maxY = Math.max(maxY, child.position.y + height);
    }

    const shiftX = minX < PARENT_PADDING_X ? PARENT_PADDING_X - minX : 0;
    const shiftY = minY < PARENT_PADDING_Y ? PARENT_PADDING_Y - minY : 0;

    if (shiftX !== 0 || shiftY !== 0) {
      for (const child of children) {
        child.position = {
          x: child.position.x + shiftX,
          y: child.position.y + shiftY,
        };
      }
      maxX += shiftX;
      maxY += shiftY;
    }

    const desiredWidth = Math.max(
      parent.data.kind === 'parallel' ? 320 : 260,
      Math.ceil(maxX + PARENT_PADDING_X),
    );
    const desiredHeight = Math.max(
      parent.data.kind === 'parallel' ? 220 : 180,
      Math.ceil(maxY + PARENT_PADDING_Y),
    );

    parent.style = {
      ...(parent.style ?? {}),
      width: desiredWidth,
      height: desiredHeight,
    };
  }

  return nextNodes;
}

export function autoLayoutNodes(nodes: StateNode[], edges: TransitionEdge[]): StateNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groups = groupNodesByParent(nodes);
  const sortedGroups = [...groups.entries()].sort(
    (a, b) => groupDepth(a[0], nodeById) - groupDepth(b[0], nodeById),
  );

  const laidOutById = new Map<string, StateNode>(nodes.map((node) => [node.id, { ...node }]));

  for (const [parentId, groupNodes] of sortedGroups) {
    const hydrated = groupNodes.map((node) => laidOutById.get(node.id) ?? node);
    const laidOutGroup = layoutGroup(hydrated, edges, parentId !== null);

    for (const node of laidOutGroup) {
      laidOutById.set(node.id, {
        ...node,
        parentNode: parentId ?? undefined,
        extent: parentId ? 'parent' : undefined,
      });
    }
  }

  return normalizeParentBounds([...laidOutById.values()]);
}

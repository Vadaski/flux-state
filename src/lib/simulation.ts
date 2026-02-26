import type { MachineDocument, StateNode, TransitionEdge } from '../types/machine';

interface SimulationMaps {
  nodeById: Map<string, StateNode>;
  edgesBySource: Map<string, TransitionEdge[]>;
  childrenByParent: Map<string | null, StateNode[]>;
}

function buildMaps(machine: MachineDocument): SimulationMaps {
  const nodeById = new Map(machine.nodes.map((node) => [node.id, node]));

  const edgesBySource = new Map<string, TransitionEdge[]>();
  for (const edge of machine.edges) {
    const existing = edgesBySource.get(edge.source) ?? [];
    existing.push(edge);
    edgesBySource.set(edge.source, existing);
  }

  const childrenByParent = new Map<string | null, StateNode[]>();
  for (const node of machine.nodes) {
    const parentId = node.parentNode ?? null;
    const existing = childrenByParent.get(parentId) ?? [];
    existing.push(node);
    childrenByParent.set(parentId, existing);
  }

  return { nodeById, edgesBySource, childrenByParent };
}

function findInitialTarget(
  parentId: string | null,
  maps: SimulationMaps,
): string | null {
  const siblings = maps.childrenByParent.get(parentId) ?? [];
  const initialMarker = siblings.find((node) => node.data.kind === 'initial');

  if (initialMarker) {
    const edge = (maps.edgesBySource.get(initialMarker.id) ?? [])[0];
    if (edge) {
      return edge.target;
    }
  }

  const fallback = siblings.find((node) => node.data.kind !== 'initial');
  return fallback?.id ?? null;
}

function enterNode(
  nodeId: string,
  maps: SimulationMaps,
  seen: Set<string> = new Set(),
): string[] {
  if (seen.has(nodeId)) {
    return [];
  }

  seen.add(nodeId);
  const node = maps.nodeById.get(nodeId);

  if (!node) {
    return [];
  }

  if (node.data.kind === 'initial') {
    const target = (maps.edgesBySource.get(node.id) ?? [])[0]?.target;
    return target ? enterNode(target, maps, seen) : [];
  }

  const children = (maps.childrenByParent.get(node.id) ?? []).filter(
    (child) => child.data.kind !== 'initial',
  );

  if (children.length === 0) {
    return [node.id];
  }

  if (node.data.kind === 'parallel') {
    const leaves = new Set<string>();
    for (const child of children) {
      for (const leaf of enterNode(child.id, maps, new Set(seen))) {
        leaves.add(leaf);
      }
    }
    return [...leaves];
  }

  const initialTarget = findInitialTarget(node.id, maps) ?? children[0]?.id;
  return initialTarget ? enterNode(initialTarget, maps, seen) : [node.id];
}

function getAncestors(nodeId: string, maps: SimulationMaps): string[] {
  const chain: string[] = [];
  let current: string | undefined = nodeId;

  while (current) {
    chain.push(current);
    current = maps.nodeById.get(current)?.parentNode;
  }

  return chain;
}

function evaluateGuard(guard: string, eventType: string): boolean {
  if (!guard.trim()) {
    return true;
  }

  try {
    const fn = new Function('context', 'event', `return (${guard});`);
    return Boolean(fn({}, { type: eventType }));
  } catch {
    return false;
  }
}

function findTransitionForEvent(
  activeLeaf: string,
  eventType: string,
  maps: SimulationMaps,
): TransitionEdge | null {
  const ancestors = getAncestors(activeLeaf, maps);

  for (const source of ancestors) {
    const transitions = maps.edgesBySource.get(source) ?? [];
    const match = transitions.find(
      (edge) => edge.data.event === eventType && evaluateGuard(edge.data.guard, eventType),
    );

    if (match) {
      return match;
    }
  }

  return null;
}

export function initialSimulationState(machine: MachineDocument): string[] {
  const maps = buildMaps(machine);
  const rootTarget = findInitialTarget(null, maps);

  if (rootTarget) {
    return enterNode(rootTarget, maps);
  }

  const fallback = machine.nodes.find(
    (node) => !node.parentNode && node.data.kind !== 'initial',
  );

  return fallback ? enterNode(fallback.id, maps) : [];
}

export function getAvailableEvents(machine: MachineDocument, activeLeafIds: string[]): string[] {
  const maps = buildMaps(machine);
  const events = new Set<string>();

  for (const leaf of activeLeafIds) {
    const ancestors = getAncestors(leaf, maps);
    for (const source of ancestors) {
      for (const edge of maps.edgesBySource.get(source) ?? []) {
        if (edge.data.event.trim()) {
          events.add(edge.data.event.trim());
        }
      }
    }
  }

  return [...events].sort((a, b) => a.localeCompare(b));
}

export function triggerSimulationEvent(
  machine: MachineDocument,
  activeLeafIds: string[],
  eventType: string,
): { nextActiveLeafIds: string[]; takenEdgeId: string | null } {
  const maps = buildMaps(machine);

  for (const leaf of activeLeafIds) {
    const transition = findTransitionForEvent(leaf, eventType, maps);

    if (!transition) {
      continue;
    }

    const nextLeaves = enterNode(transition.target, maps);
    return {
      nextActiveLeafIds: nextLeaves,
      takenEdgeId: transition.id,
    };
  }

  return {
    nextActiveLeafIds: activeLeafIds,
    takenEdgeId: null,
  };
}

export function isNodeActive(nodeId: string, activeLeafIds: string[], machine: MachineDocument): boolean {
  if (activeLeafIds.includes(nodeId)) {
    return true;
  }

  const byId = new Map(machine.nodes.map((node) => [node.id, node]));

  for (const leaf of activeLeafIds) {
    let current = byId.get(leaf)?.parentNode;
    while (current) {
      if (current === nodeId) {
        return true;
      }
      current = byId.get(current)?.parentNode;
    }
  }

  return false;
}

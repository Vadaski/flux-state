import type { MachineDocument, NodeKind, StateNode, TransitionData, TransitionEdge } from '../types/machine';
import { createId, slugify } from './ids';
import { MarkerType } from 'reactflow';

interface XStateTransition {
  target?: string | string[];
  guard?: string;
  cond?: string;
  actions?: string | string[];
}

interface XStateState {
  id?: string;
  type?: string;
  initial?: string;
  states?: Record<string, XStateState>;
  on?: Record<string, string | XStateTransition | Array<string | XStateTransition>>;
  meta?: {
    kind?: NodeKind;
    position?: { x: number; y: number };
    style?: Record<string, unknown>;
    fluxState?: MachineDocument;
  };
}

interface XStateRoot extends XStateState {
  id?: string;
}

function toSerializableMachine(machine: MachineDocument): MachineDocument {
  return JSON.parse(JSON.stringify(machine)) as MachineDocument;
}

function buildChildrenMap(nodes: StateNode[]): Map<string | null, StateNode[]> {
  const map = new Map<string | null, StateNode[]>();

  for (const node of nodes) {
    const parentId = node.parentNode ?? null;
    const existing = map.get(parentId) ?? [];
    existing.push(node);
    map.set(parentId, existing);
  }

  return map;
}

function buildEdgeMap(edges: TransitionEdge[]): Map<string, TransitionEdge[]> {
  const map = new Map<string, TransitionEdge[]>();

  for (const edge of edges) {
    const existing = map.get(edge.source) ?? [];
    existing.push(edge);
    map.set(edge.source, existing);
  }

  return map;
}

function firstInitialTarget(
  parentId: string | null,
  childrenMap: Map<string | null, StateNode[]>,
  edgeMap: Map<string, TransitionEdge[]>,
): string | null {
  const siblings = childrenMap.get(parentId) ?? [];
  const marker = siblings.find((node) => node.data.kind === 'initial');

  if (!marker) {
    return null;
  }

  const edge = (edgeMap.get(marker.id) ?? [])[0];
  return edge?.target ?? null;
}

function toTransitionValue(edge: TransitionEdge): XStateTransition {
  const transition: XStateTransition = {
    target: `#${edge.target}`,
  };

  const guard = edge.data.guard.trim();
  if (guard) {
    transition.guard = guard;
  }

  const actions = edge.data.actions.filter((entry) => entry.trim().length > 0);
  if (actions.length === 1) {
    transition.actions = actions[0];
  } else if (actions.length > 1) {
    transition.actions = actions;
  }

  return transition;
}

function createStateBuilder(machine: MachineDocument) {
  const childrenMap = buildChildrenMap(machine.nodes);
  const edgeMap = buildEdgeMap(machine.edges);

  function buildStatesForParent(parentId: string | null): {
    states: Record<string, XStateState>;
    idToKey: Record<string, string>;
  } {
    const children = (childrenMap.get(parentId) ?? []).filter((node) => node.data.kind !== 'initial');
    const keyCount = new Map<string, number>();
    const idToKey: Record<string, string> = {};

    for (const child of children) {
      const base = slugify(child.data.label);
      const count = keyCount.get(base) ?? 0;
      keyCount.set(base, count + 1);
      idToKey[child.id] = count === 0 ? base : `${base}_${count + 1}`;
    }

    const states: Record<string, XStateState> = {};

    for (const child of children) {
      const key = idToKey[child.id];
      const stateConfig: XStateState = {
        id: child.id,
        meta: {
          kind: child.data.kind,
          position: child.position,
          style: child.style as Record<string, unknown> | undefined,
        },
      };

      if (child.data.kind === 'final') {
        stateConfig.type = 'final';
      }

      if (child.data.kind === 'parallel') {
        stateConfig.type = 'parallel';
      }

      const nested = buildStatesForParent(child.id);
      if (Object.keys(nested.states).length > 0) {
        stateConfig.states = nested.states;
      }

      if (stateConfig.type !== 'parallel') {
        const initialTargetId = firstInitialTarget(child.id, childrenMap, edgeMap);
        if (initialTargetId && nested.idToKey[initialTargetId]) {
          stateConfig.initial = nested.idToKey[initialTargetId];
        }
      }

      const transitions = edgeMap.get(child.id) ?? [];
      const grouped: Record<string, XStateTransition[]> = {};

      for (const edge of transitions) {
        const eventType = edge.data.event.trim();
        if (!eventType) {
          continue;
        }

        const existing = grouped[eventType] ?? [];
        existing.push(toTransitionValue(edge));
        grouped[eventType] = existing;
      }

      if (Object.keys(grouped).length > 0) {
        stateConfig.on = {};
        for (const [eventType, entries] of Object.entries(grouped)) {
          stateConfig.on[eventType] = entries.length === 1 ? entries[0] : entries;
        }
      }

      states[key] = stateConfig;
    }

    return { states, idToKey };
  }

  return {
    buildRootState(): XStateRoot {
      const root = buildStatesForParent(null);
      const rootInitialTarget = firstInitialTarget(null, childrenMap, edgeMap);
      const firstStateKey = Object.keys(root.states)[0];

      const result: XStateRoot = {
        id: machine.machineId,
        states: root.states,
        meta: {
          fluxState: toSerializableMachine(machine),
        },
      };

      if (rootInitialTarget && root.idToKey[rootInitialTarget]) {
        result.initial = root.idToKey[rootInitialTarget];
      } else if (firstStateKey) {
        result.initial = firstStateKey;
      }

      return result;
    },
  };
}

function readActions(value: XStateTransition['actions']): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  return [String(value)];
}

function normalizeTransitions(
  value: string | XStateTransition | Array<string | XStateTransition>,
): XStateTransition[] {
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === 'string' ? { target: entry } : entry));
  }

  if (typeof value === 'string') {
    return [{ target: value }];
  }

  return [value];
}

function resolveTarget(
  target: string,
  currentPath: string,
  pathToId: Map<string, string>,
  idSet: Set<string>,
): string | null {
  if (!target) {
    return null;
  }

  if (target.startsWith('#')) {
    const absoluteId = target.slice(1);
    return idSet.has(absoluteId) ? absoluteId : null;
  }

  if (pathToId.has(target)) {
    return pathToId.get(target) ?? null;
  }

  const parentPath = currentPath.includes('.')
    ? currentPath.slice(0, currentPath.lastIndexOf('.'))
    : '';

  const candidate = parentPath ? `${parentPath}.${target}` : target;
  if (pathToId.has(candidate)) {
    return pathToId.get(candidate) ?? null;
  }

  const localChildCandidate = `${currentPath}.${target}`;
  if (pathToId.has(localChildCandidate)) {
    return pathToId.get(localChildCandidate) ?? null;
  }

  return null;
}

export function exportMachineAsXState(machine: MachineDocument): string {
  const builder = createStateBuilder(machine);
  return JSON.stringify(builder.buildRootState(), null, 2);
}

function isMachineDocument(value: unknown): value is MachineDocument {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<MachineDocument>;
  return (
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    typeof candidate.machineId === 'string'
  );
}

function normalizeImportedMachine(machine: MachineDocument): MachineDocument {
  return {
    version: 1,
    machineId: machine.machineId || 'importedMachine',
    nodes: machine.nodes.map((node) => ({
      ...node,
      type: 'stateNode',
      data: {
        label: node.data.label ?? node.id,
        kind: (node.data.kind ?? 'atomic') as NodeKind,
      },
      extent: node.parentNode ? ('parent' as const) : undefined,
    })),
    edges: machine.edges.map((edge) => ({
      ...edge,
      type: 'transitionEdge',
      markerEnd: edge.markerEnd ?? { type: MarkerType.ArrowClosed },
      data: {
        event: edge.data.event ?? 'EVENT',
        guard: edge.data.guard ?? '',
        actions: edge.data.actions ?? [],
      } satisfies TransitionData,
    })),
    viewport: machine.viewport ?? { x: 0, y: 0, zoom: 1 },
  };
}

export function importMachineFromXState(raw: string): MachineDocument {
  const parsed = JSON.parse(raw) as XStateRoot;

  const embedded = parsed.meta?.fluxState;
  if (isMachineDocument(embedded)) {
    return normalizeImportedMachine(embedded);
  }

  const machineId = parsed.id || 'importedMachine';
  const nodes: StateNode[] = [];
  const edges: TransitionEdge[] = [];
  const pathToId = new Map<string, string>();
  const idToPath = new Map<string, string>();

  const createNode = (
    key: string,
    config: XStateState,
    parentId: string | null,
    path: string,
    index: number,
  ) => {
    const id = config.id || path;
    const kind: NodeKind =
      config.type === 'final' ? 'final' : config.type === 'parallel' ? 'parallel' : 'atomic';

    const metaPosition = config.meta?.position;
    const defaultX = 90 + (index % 4) * 220;
    const defaultY = 90 + Math.floor(index / 4) * 150;

    const node: StateNode = {
      id,
      type: 'stateNode',
      position: metaPosition ?? { x: defaultX, y: defaultY },
      parentNode: parentId ?? undefined,
      extent: parentId ? ('parent' as const) : undefined,
      style:
        (config.meta?.style as StateNode['style']) ??
        (kind === 'parallel'
          ? {
              width: 320,
              height: 220,
            }
          : undefined),
      data: {
        label: key,
        kind,
      },
    };

    nodes.push(node);
    pathToId.set(path, id);
    idToPath.set(id, path);
  };

  const walkStates = (
    states: Record<string, XStateState> | undefined,
    parentId: string | null,
    parentPath: string,
  ) => {
    if (!states) {
      return;
    }

    let index = 0;

    for (const [key, config] of Object.entries(states)) {
      const path = parentPath ? `${parentPath}.${key}` : key;
      createNode(key, config, parentId, path, index);
      walkStates(config.states, config.id || path, path);
      index += 1;
    }
  };

  walkStates(parsed.states, null, '');

  const idSet = new Set(nodes.map((node) => node.id));

  const createInitialMarker = (
    parentId: string | null,
    parentPath: string,
    initialKey: string,
  ) => {
    const targetPath = parentPath ? `${parentPath}.${initialKey}` : initialKey;
    const targetId = pathToId.get(targetPath);

    if (!targetId) {
      return;
    }

    const markerId = createId(parentId ? 'initial_child' : 'initial_root');
    const markerNode: StateNode = {
      id: markerId,
      type: 'stateNode',
      position: parentId ? { x: 22, y: 22 } : { x: 40, y: 120 },
      parentNode: parentId ?? undefined,
      extent: parentId ? ('parent' as const) : undefined,
      data: {
        label: 'Initial',
        kind: 'initial',
      },
    };

    nodes.push(markerNode);
    edges.push({
      id: createId('edge'),
      type: 'transitionEdge',
      source: markerId,
      target: targetId,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        event: 'INIT',
        guard: '',
        actions: [],
      },
    });
  };

  const walkTransitions = (states: Record<string, XStateState> | undefined, parentPath: string) => {
    if (!states) {
      return;
    }

    for (const [key, config] of Object.entries(states)) {
      const statePath = parentPath ? `${parentPath}.${key}` : key;
      const sourceId = pathToId.get(statePath);

      if (!sourceId) {
        continue;
      }

      if (config.initial) {
        createInitialMarker(sourceId, statePath, config.initial);
      }

      const on = config.on ?? {};

      for (const [eventType, targetConfig] of Object.entries(on)) {
        const transitions = normalizeTransitions(targetConfig);

        for (const transition of transitions) {
          const targets = Array.isArray(transition.target)
            ? transition.target
            : transition.target
              ? [transition.target]
              : [];

          for (const target of targets) {
            const resolvedTarget = resolveTarget(target, statePath, pathToId, idSet);

            if (!resolvedTarget) {
              continue;
            }

            edges.push({
              id: createId('edge'),
              type: 'transitionEdge',
              source: sourceId,
              target: resolvedTarget,
              markerEnd: { type: MarkerType.ArrowClosed },
              data: {
                event: eventType,
                guard: transition.guard ?? transition.cond ?? '',
                actions: readActions(transition.actions),
              },
            });
          }
        }
      }

      walkTransitions(config.states, statePath);
    }
  };

  if (parsed.initial) {
    createInitialMarker(null, '', parsed.initial);
  }

  walkTransitions(parsed.states, '');

  return normalizeImportedMachine({
    version: 1,
    machineId,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}

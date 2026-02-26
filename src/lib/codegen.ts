import type { CodeTarget, MachineDocument, StateNode, TransitionEdge } from '../types/machine';
import { slugify, toIdentifier } from './ids';

interface CodeBuildContext {
  childrenByParent: Map<string | null, StateNode[]>;
  edgesBySource: Map<string, TransitionEdge[]>;
  keyByParent: Map<string | null, Map<string, string>>;
}

function createContext(machine: MachineDocument): CodeBuildContext {
  const childrenByParent = new Map<string | null, StateNode[]>();
  const edgesBySource = new Map<string, TransitionEdge[]>();
  const keyByParent = new Map<string | null, Map<string, string>>();

  for (const node of machine.nodes) {
    const parentId = node.parentNode ?? null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(parentId, siblings);
  }

  for (const edge of machine.edges) {
    const list = edgesBySource.get(edge.source) ?? [];
    list.push(edge);
    edgesBySource.set(edge.source, list);
  }

  for (const [parentId, children] of childrenByParent.entries()) {
    const keyCount = new Map<string, number>();
    const byId = new Map<string, string>();

    for (const child of children.filter((node) => node.data.kind !== 'initial')) {
      const base = slugify(child.data.label);
      const count = keyCount.get(base) ?? 0;
      keyCount.set(base, count + 1);
      byId.set(child.id, count === 0 ? base : `${base}_${count + 1}`);
    }

    keyByParent.set(parentId, byId);
  }

  return {
    childrenByParent,
    edgesBySource,
    keyByParent,
  };
}

function getInitialTarget(parentId: string | null, ctx: CodeBuildContext): string | null {
  const siblings = ctx.childrenByParent.get(parentId) ?? [];
  const marker = siblings.find((node) => node.data.kind === 'initial');

  if (!marker) {
    return null;
  }

  return (ctx.edgesBySource.get(marker.id) ?? [])[0]?.target ?? null;
}

function indent(level: number): string {
  return '  '.repeat(level);
}

function stringifyActions(actions: string[]): string {
  if (actions.length === 0) {
    return '[]';
  }

  return `[${actions.map((action) => `'${action}'`).join(', ')}]`;
}

function formatTransition(transition: TransitionEdge, level: number): string {
  const lines: string[] = [];
  lines.push(`${indent(level)}{`);
  lines.push(`${indent(level + 1)}target: '#${transition.target}',`);

  if (transition.data.guard.trim()) {
    lines.push(
      `${indent(level + 1)}guard: ({ context, event }) => (${transition.data.guard.trim()}),`,
    );
  }

  if (transition.data.actions.length > 0) {
    lines.push(
      `${indent(level + 1)}actions: ${stringifyActions(
        transition.data.actions.map((entry) => entry.trim()).filter(Boolean),
      )},`,
    );
  }

  lines.push(`${indent(level)}}`);
  return lines.join('\n');
}

function buildXStateStateBlock(
  node: StateNode,
  ctx: CodeBuildContext,
  level: number,
): string {
  const lines: string[] = [];
  lines.push(`${indent(level)}{`);
  lines.push(`${indent(level + 1)}id: '${node.id}',`);

  if (node.data.kind === 'final') {
    lines.push(`${indent(level + 1)}type: 'final',`);
  }

  if (node.data.kind === 'parallel') {
    lines.push(`${indent(level + 1)}type: 'parallel',`);
  }

  const children = (ctx.childrenByParent.get(node.id) ?? []).filter(
    (child) => child.data.kind !== 'initial',
  );

  if (children.length > 0) {
    const childKeyMap = ctx.keyByParent.get(node.id) ?? new Map<string, string>();
    const nestedInitialTarget = getInitialTarget(node.id, ctx);

    if (nestedInitialTarget && childKeyMap.get(nestedInitialTarget) && node.data.kind !== 'parallel') {
      lines.push(`${indent(level + 1)}initial: '${childKeyMap.get(nestedInitialTarget)}',`);
    }

    lines.push(`${indent(level + 1)}states: {`);
    for (const child of children) {
      const childKey = childKeyMap.get(child.id) ?? slugify(child.data.label);
      lines.push(`${indent(level + 2)}${childKey}: ${buildXStateStateBlock(child, ctx, level + 2)},`);
    }
    lines.push(`${indent(level + 1)}}`,);
  }

  const transitions = (ctx.edgesBySource.get(node.id) ?? []).filter(
    (edge) => edge.data.event.trim().length > 0,
  );

  if (transitions.length > 0) {
    const byEvent = new Map<string, TransitionEdge[]>();

    for (const transition of transitions) {
      const event = transition.data.event.trim();
      const existing = byEvent.get(event) ?? [];
      existing.push(transition);
      byEvent.set(event, existing);
    }

    lines.push(`${indent(level + 1)}on: {`);

    for (const [eventType, list] of byEvent.entries()) {
      if (list.length === 1) {
        lines.push(`${indent(level + 2)}${eventType}: ${formatTransition(list[0], level + 2)},`);
      } else {
        lines.push(`${indent(level + 2)}${eventType}: [`);
        for (const transition of list) {
          lines.push(`${formatTransition(transition, level + 3)},`);
        }
        lines.push(`${indent(level + 2)}],`);
      }
    }

    lines.push(`${indent(level + 1)}},`);
  }

  lines.push(`${indent(level)}}`);
  return lines.join('\n');
}

function generateXStateV5(machine: MachineDocument): string {
  const ctx = createContext(machine);
  const topLevelStates = (ctx.childrenByParent.get(null) ?? []).filter(
    (node) => node.data.kind !== 'initial',
  );
  const topLevelKeys = ctx.keyByParent.get(null) ?? new Map<string, string>();
  const rootInitialTarget = getInitialTarget(null, ctx);
  const machineInitial =
    (rootInitialTarget && topLevelKeys.get(rootInitialTarget)) ||
    (topLevelStates[0] ? topLevelKeys.get(topLevelStates[0].id) : undefined) ||
    'state';

  const lines: string[] = [];
  lines.push("import { createMachine } from 'xstate';");
  lines.push('');
  lines.push(`export const ${toIdentifier(machine.machineId)}Machine = createMachine({`);
  lines.push(`  id: '${machine.machineId}',`);
  lines.push(`  initial: '${machineInitial}',`);
  lines.push('  states: {');

  for (const node of topLevelStates) {
    const key = topLevelKeys.get(node.id) ?? slugify(node.data.label);
    lines.push(`    ${key}: ${buildXStateStateBlock(node, ctx, 2)},`);
  }

  lines.push('  },');
  lines.push('});');

  return lines.join('\n');
}

function enumName(node: StateNode): string {
  return toIdentifier(node.data.label || node.id)
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toUpperCase();
}

function generateEnumSwitch(machine: MachineDocument): string {
  const states = machine.nodes.filter((node) => node.data.kind !== 'initial');
  const stateNameById = new Map(states.map((node) => [node.id, enumName(node)]));

  const events = [...new Set(machine.edges.map((edge) => edge.data.event.trim()).filter(Boolean))];

  const lines: string[] = [];
  lines.push('export enum MachineState {');
  for (const node of states) {
    lines.push(`  ${stateNameById.get(node.id)} = '${node.id}',`);
  }
  lines.push('}');
  lines.push('');

  if (events.length === 0) {
    lines.push("export type MachineEvent = { type: 'NO_EVENT' };");
  } else {
    lines.push(
      `export type MachineEvent = ${events
        .map((event) => `{ type: '${event}' }`)
        .join(' | ')};`,
    );
  }

  lines.push('');
  lines.push('export function transition(');
  lines.push('  state: MachineState,');
  lines.push('  event: MachineEvent,');
  lines.push('  context: Record<string, unknown> = {},');
  lines.push('): { state: MachineState; actions: string[] } {');
  lines.push('  switch (state) {');

  for (const node of states) {
    const transitions = machine.edges.filter((edge) => edge.source === node.id);
    lines.push(`    case MachineState.${stateNameById.get(node.id)}: {`);

    if (transitions.length === 0) {
      lines.push('      return { state, actions: [] };');
      lines.push('    }');
      continue;
    }

    lines.push('      switch (event.type) {');

    const eventMap = new Map<string, TransitionEdge[]>();
    for (const transition of transitions) {
      const eventType = transition.data.event.trim();
      if (!eventType) {
        continue;
      }
      const existing = eventMap.get(eventType) ?? [];
      existing.push(transition);
      eventMap.set(eventType, existing);
    }

    for (const [eventType, list] of eventMap.entries()) {
      lines.push(`        case '${eventType}': {`);
      for (const transition of list) {
        const target = stateNameById.get(transition.target);
        if (!target) {
          continue;
        }

        const guard = transition.data.guard.trim();
        if (guard) {
          lines.push(`          if (${guard}) {`);
          lines.push(
            `            return { state: MachineState.${target}, actions: ${stringifyActions(
              transition.data.actions,
            )} };`,
          );
          lines.push('          }');
        } else {
          lines.push(
            `          return { state: MachineState.${target}, actions: ${stringifyActions(
              transition.data.actions,
            )} };`,
          );
        }
      }
      lines.push('          return { state, actions: [] };');
      lines.push('        }');
    }

    lines.push('        default:');
    lines.push('          return { state, actions: [] };');
    lines.push('      }');
    lines.push('    }');
  }

  lines.push('    default:');
  lines.push('      return { state, actions: [] };');
  lines.push('  }');
  lines.push('}');

  return lines.join('\n');
}

function generateZustand(machine: MachineDocument): string {
  const states = machine.nodes.filter((node) => node.data.kind !== 'initial');
  const defaultState = states[0]?.id ?? 'unknown';
  const events = [...new Set(machine.edges.map((edge) => edge.data.event.trim()).filter(Boolean))];

  const lines: string[] = [];
  lines.push("import { create } from 'zustand';");
  lines.push('');

  lines.push(`type MachineEvent = ${
    events.length
      ? events.map((event) => `{ type: '${event}' }`).join(' | ')
      : "{ type: 'NO_EVENT' }"
  };`);
  lines.push('');

  lines.push('interface MachineStore {');
  lines.push('  currentState: string;');
  lines.push('  history: string[];');
  lines.push('  send: (event: MachineEvent) => void;');
  lines.push('}');
  lines.push('');

  lines.push('export const useMachineStore = create<MachineStore>((set, get) => ({');
  lines.push(`  currentState: '${defaultState}',`);
  lines.push(`  history: ['${defaultState}'],`);
  lines.push('  send: (event) => {');
  lines.push('    const currentState = get().currentState;');
  lines.push('    const context: Record<string, unknown> = {};');
  lines.push('    let nextState = currentState;');
  lines.push('');
  lines.push('    switch (currentState) {');

  for (const node of states) {
    lines.push(`      case '${node.id}': {`);

    const outgoing = machine.edges.filter((edge) => edge.source === node.id);
    if (outgoing.length === 0) {
      lines.push('        break;');
      lines.push('      }');
      continue;
    }

    lines.push('        switch (event.type) {');

    const byEvent = new Map<string, TransitionEdge[]>();
    for (const transition of outgoing) {
      const eventType = transition.data.event.trim();
      if (!eventType) {
        continue;
      }
      const existing = byEvent.get(eventType) ?? [];
      existing.push(transition);
      byEvent.set(eventType, existing);
    }

    for (const [eventType, transitions] of byEvent.entries()) {
      lines.push(`          case '${eventType}': {`);
      for (const transition of transitions) {
        const guard = transition.data.guard.trim();
        if (guard) {
          lines.push(`            if (${guard}) {`);
          lines.push(`              nextState = '${transition.target}';`);
          lines.push('              break;');
          lines.push('            }');
        } else {
          lines.push(`            nextState = '${transition.target}';`);
          lines.push('            break;');
        }
      }
      lines.push('            break;');
      lines.push('          }');
    }

    lines.push('          default:');
    lines.push('            break;');
    lines.push('        }');
    lines.push('        break;');
    lines.push('      }');
  }

  lines.push('      default:');
  lines.push('        break;');
  lines.push('    }');
  lines.push('');
  lines.push('    if (nextState !== currentState) {');
  lines.push('      set((state) => ({');
  lines.push('        currentState: nextState,');
  lines.push('        history: [...state.history, nextState],');
  lines.push('      }));');
  lines.push('    }');
  lines.push('  },');
  lines.push('}));');

  return lines.join('\n');
}

export function generateCode(machine: MachineDocument, target: CodeTarget): string {
  if (target === 'xstate') {
    return generateXStateV5(machine);
  }

  if (target === 'switch') {
    return generateEnumSwitch(machine);
  }

  return generateZustand(machine);
}

import type { Edge, EdgeMarkerType, Node, Viewport } from 'reactflow';

export type NodeKind = 'atomic' | 'initial' | 'final' | 'parallel';

export interface StateNodeData {
  label: string;
  kind: NodeKind;
}

export interface TransitionData {
  event: string;
  guard: string;
  actions: string[];
  __active?: boolean;
}

export type StateNode = Node<StateNodeData> & {
  type: 'stateNode';
  data: StateNodeData;
};

export type TransitionEdge = Edge<TransitionData> & {
  type: 'transitionEdge';
  data: TransitionData;
  markerEnd?: EdgeMarkerType;
};

export interface MachineDocument {
  version: 1;
  machineId: string;
  nodes: StateNode[];
  edges: TransitionEdge[];
  viewport: Viewport;
}

export type CodeTarget = 'xstate' | 'switch' | 'zustand';

export interface EdgeMenuState {
  edgeId: string;
  x: number;
  y: number;
}

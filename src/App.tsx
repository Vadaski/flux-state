import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  type Connection,
  type EdgeChange,
  type Edge,
  type NodeChange,
  type Node,
  type ReactFlowInstance,
} from 'reactflow';
import { StateNodeView } from './components/StateNode';
import { TransitionEdgeView } from './components/TransitionEdge';
import { CodeViewer } from './components/CodeViewer';
import { SplashScreen } from './components/SplashScreen';
import {
  cloneValue,
  createHistoryState,
  redoHistory,
  undoHistory,
  withHistoryPush,
  withHistoryPushFromSnapshot,
  withHistoryReplace,
  type HistoryState,
} from './lib/history';
import { autoLayoutNodes } from './lib/layout';
import { createId } from './lib/ids';
import { exportMachineAsXState, importMachineFromXState } from './lib/machine-format';
import { generateCode } from './lib/codegen';
import { formatGeneratedCode } from './lib/code-format';
import {
  getAvailableEvents,
  initialSimulationState,
  isNodeActive,
  triggerSimulationEvent,
} from './lib/simulation';
import { exampleMachines } from './examples/machines';
import type { CodeTarget, EdgeMenuState, MachineDocument, StateNode, TransitionEdge } from './types/machine';

const nodeTypes = {
  stateNode: StateNodeView,
};

const edgeTypes = {
  transitionEdge: TransitionEdgeView,
};

const ARROW_MARKER = { type: MarkerType.ArrowClosed } as const;
const SNAP_GRID: [number, number] = [24, 24];
const DEFAULT_TRANSITION_DATA = { event: 'EVENT', guard: '', actions: [] as string[] };
const BUTTON_BASE_CLASS =
  'cursor-pointer rounded-md border px-3 py-2 text-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100';
const BUTTON_SECONDARY_CLASS =
  `${BUTTON_BASE_CLASS} border-slate-700 bg-slate-800 hover:border-slate-500 hover:bg-slate-700`;
const BUTTON_PRIMARY_CLASS =
  `${BUTTON_BASE_CLASS} border-cyan-700 bg-cyan-900/40 hover:border-cyan-500 hover:bg-cyan-800/50`;
const BUTTON_DANGER_CLASS =
  `${BUTTON_BASE_CLASS} border-red-700 bg-red-900/30 hover:border-red-500 hover:bg-red-800/50`;
const FIELD_CLASS =
  'w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70';
const FIELD_COMPACT_CLASS =
  'mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70';
type HistoryMode = 'push' | 'replace' | 'transient';

function normalizeNode(node: Node<StateNode['data']>): StateNode {
  return {
    ...(node as StateNode),
    type: 'stateNode',
    data: node.data ?? { label: node.id, kind: 'atomic' },
    extent: node.parentNode ? 'parent' : undefined,
  };
}

function normalizeEdge(edge: Partial<TransitionEdge>): TransitionEdge {
  return {
    ...(edge as TransitionEdge),
    id: edge.id ?? createId('edge'),
    source: edge.source ?? '',
    target: edge.target ?? '',
    type: 'transitionEdge',
    markerEnd: edge.markerEnd ?? ARROW_MARKER,
    data: {
      ...DEFAULT_TRANSITION_DATA,
      ...(edge.data ?? {}),
      actions: edge.data?.actions ?? [],
    },
  };
}

function makeDefaultMachine(): MachineDocument {
  return cloneValue(exampleMachines[0].machine);
}

function getNodeHistoryMode(changes: NodeChange[]): HistoryMode {
  let hasCommit = false;
  let hasTransient = false;

  for (const change of changes) {
    if (change.type === 'select') {
      continue;
    }

    if (change.type === 'position') {
      if (change.dragging) {
        hasTransient = true;
        continue;
      }
    }

    hasCommit = true;
  }

  if (hasCommit) {
    return 'push';
  }

  if (hasTransient) {
    return 'transient';
  }

  return 'replace';
}

function getEdgeHistoryMode(changes: EdgeChange[]): HistoryMode {
  return changes.some((change) => change.type !== 'select') ? 'push' : 'replace';
}

function parseActions(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function snapPosition(position: { x: number; y: number }, enabled: boolean): { x: number; y: number } {
  if (!enabled) {
    return position;
  }

  return {
    x: Math.round(position.x / SNAP_GRID[0]) * SNAP_GRID[0],
    y: Math.round(position.y / SNAP_GRID[1]) * SNAP_GRID[1],
  };
}

function edgeLabel(edge: TransitionEdge): string {
  const parts: string[] = [edge.data.event || 'EVENT'];
  if (edge.data.guard.trim()) {
    parts.push(`[${edge.data.guard.trim()}]`);
  }
  if (edge.data.actions.length > 0) {
    parts.push(`/ ${edge.data.actions.join(', ')}`);
  }
  return parts.join(' ');
}

function isDescendant(nodes: StateNode[], candidateParentId: string, nodeId: string): boolean {
  let current = nodes.find((node) => node.id === candidateParentId)?.parentNode;

  while (current) {
    if (current === nodeId) {
      return true;
    }
    current = nodes.find((node) => node.id === current)?.parentNode;
  }

  return false;
}

function App() {
  const [history, setHistory] = useState<HistoryState<MachineDocument>>(() =>
    createHistoryState(makeDefaultMachine()),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedExampleId, setSelectedExampleId] = useState<string>(exampleMachines[0].id);
  const [edgeMenu, setEdgeMenu] = useState<EdgeMenuState | null>(null);
  const [edgeEvent, setEdgeEvent] = useState('');
  const [edgeGuard, setEdgeGuard] = useState('');
  const [edgeActions, setEdgeActions] = useState('');
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [activeLeafIds, setActiveLeafIds] = useState<string[]>([]);
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);
  const [showCodePanel, setShowCodePanel] = useState(false);
  const [codeTarget, setCodeTarget] = useState<CodeTarget>('xstate');
  const [jsonDialogMode, setJsonDialogMode] = useState<'import' | 'export' | null>(null);
  const [jsonPayload, setJsonPayload] = useState('');
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [connectingFromNodeId, setConnectingFromNodeId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transientHistoryRef = useRef<MachineDocument | null>(null);

  const machine = history.present;

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const selectedNode = machine.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = edgeMenu
    ? machine.edges.find((edge) => edge.id === edgeMenu.edgeId) ?? null
    : null;

  const generatedCode = useMemo(
    () => formatGeneratedCode(generateCode(machine, codeTarget)),
    [machine, codeTarget],
  );
  const availableEvents = useMemo(
    () => (isSimulationMode ? getAvailableEvents(machine, activeLeafIds) : []),
    [isSimulationMode, machine, activeLeafIds],
  );

  const updateMachine = useCallback(
    (updater: (current: MachineDocument) => MachineDocument, mode: HistoryMode = 'push') => {
      setHistory((previous) => {
        const current = cloneValue(previous.present);
        const next = updater(current);

        if (mode === 'transient') {
          if (!transientHistoryRef.current) {
            transientHistoryRef.current = cloneValue(previous.present);
          }
          return withHistoryReplace(previous, next);
        }

        if (mode === 'replace') {
          return withHistoryReplace(previous, next);
        }

        const snapshot = transientHistoryRef.current;
        transientHistoryRef.current = null;

        if (snapshot) {
          return withHistoryPushFromSnapshot(previous, snapshot, next);
        }

        return withHistoryPush(previous, next);
      });
    },
    [],
  );

  const undo = useCallback(() => {
    transientHistoryRef.current = null;
    setHistory((previous) => undoHistory(previous));
  }, []);

  const redo = useCallback(() => {
    transientHistoryRef.current = null;
    setHistory((previous) => redoHistory(previous));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const cmd = event.metaKey || event.ctrlKey;
      if (!cmd) {
        return;
      }

      if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  useEffect(() => {
    if (!edgeMenu) {
      return;
    }

    const closeMenu = () => {
      setEdgeMenu(null);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-edge-menu]')) {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [edgeMenu]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const historyMode = getNodeHistoryMode(changes);
      updateMachine(
        (current) => ({
          ...current,
          nodes: applyNodeChanges(changes, current.nodes).map((node) =>
            normalizeNode(node as Node<StateNode['data']>),
          ),
        }),
        historyMode,
      );
    },
    [updateMachine],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const historyMode = getEdgeHistoryMode(changes);
      updateMachine(
        (current) => ({
          ...current,
          edges: applyEdgeChanges(changes, current.edges)
            .map((edge) => normalizeEdge(edge as TransitionEdge))
            .filter((edge) => edge.source && edge.target),
        }),
        historyMode,
      );
    },
    [updateMachine],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = connection.source;
      const target = connection.target;

      if (!source || !target) {
        return;
      }

      updateMachine((current) => {
        const eventName = `EVENT_${current.edges.length + 1}`;

        const nextEdge: TransitionEdge = {
          id: createId('edge'),
          type: 'transitionEdge',
          source,
          target,
          markerEnd: ARROW_MARKER,
          data: {
            event: eventName,
            guard: '',
            actions: [],
          },
        };

        return {
          ...current,
          edges: addEdge(nextEdge, current.edges).map((edge) =>
            normalizeEdge(edge as TransitionEdge),
          ),
        };
      });
    },
    [updateMachine],
  );

  const createNodeAtPointer = useCallback(
    (event: React.MouseEvent) => {
      if (!reactFlowInstance) {
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const snappedPosition = snapPosition(position, snapToGrid);

      updateMachine((current) => {
        const nextNode: StateNode = {
          id: createId('state'),
          type: 'stateNode',
          position: snappedPosition,
          data: {
            label: `State ${current.nodes.filter((node) => node.data.kind !== 'initial').length + 1}`,
            kind: 'atomic',
          },
        };

        return {
          ...current,
          nodes: [...current.nodes, nextNode],
        };
      });
    },
    [reactFlowInstance, snapToGrid, updateMachine],
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      const normalizedEdge = normalizeEdge(edge as TransitionEdge);
      event.preventDefault();
      setSelectedNodeId(null);
      setEdgeMenu({
        edgeId: normalizedEdge.id,
        x: event.clientX,
        y: event.clientY,
      });
      setEdgeEvent(normalizedEdge.data.event);
      setEdgeGuard(normalizedEdge.data.guard);
      setEdgeActions(normalizedEdge.data.actions.join(', '));
    },
    [],
  );

  const handleApplyEdgeChanges = useCallback(() => {
    if (!edgeMenu) {
      return;
    }

    updateMachine((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === edgeMenu.edgeId
          ? {
              ...edge,
              data: {
                event: edgeEvent.trim() || 'EVENT',
                guard: edgeGuard.trim(),
                actions: parseActions(edgeActions),
              },
            }
          : edge,
      ),
    }));

    setEdgeMenu(null);
  }, [edgeActions, edgeEvent, edgeGuard, edgeMenu, updateMachine]);

  const handleDeleteEdge = useCallback(() => {
    if (!edgeMenu) {
      return;
    }

    updateMachine((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== edgeMenu.edgeId),
    }));

    setEdgeMenu(null);
  }, [edgeMenu, updateMachine]);

  const handleToggleSimulation = useCallback(() => {
    if (isSimulationMode) {
      setIsSimulationMode(false);
      setActiveLeafIds([]);
      setActiveEdgeId(null);
      return;
    }

    setIsSimulationMode(true);
    setActiveLeafIds(initialSimulationState(machine));
    setActiveEdgeId(null);
  }, [isSimulationMode, machine]);

  const handleSimulationEvent = useCallback(
    (eventType: string) => {
      const result = triggerSimulationEvent(machine, activeLeafIds, eventType);
      setActiveLeafIds(result.nextActiveLeafIds);

      if (result.takenEdgeId) {
        setActiveEdgeId(result.takenEdgeId);
        window.setTimeout(() => setActiveEdgeId(null), 750);
      }
    },
    [activeLeafIds, machine],
  );

  const handleNodePatch = useCallback(
    (patch: Partial<StateNode['data']> & { parentNode?: string | null }) => {
      if (!selectedNode) {
        return;
      }

      updateMachine((current) => {
        const nextNodes = current.nodes.map((node) => {
          if (node.id !== selectedNode.id) {
            return node;
          }

          const parentNode =
            patch.parentNode === undefined
              ? node.parentNode
              : patch.parentNode || undefined;

          return {
            ...node,
            parentNode,
            extent: parentNode ? ('parent' as const) : undefined,
            position:
              patch.parentNode !== undefined && patch.parentNode !== null
                ? { x: 40, y: 70 }
                : node.position,
            data: {
              ...node.data,
              ...(patch.label !== undefined ? { label: patch.label } : {}),
              ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
            },
            style:
              patch.kind === 'parallel'
                ? {
                    ...(node.style ?? {}),
                    width: typeof node.style?.width === 'number' ? node.style.width : 320,
                    height: typeof node.style?.height === 'number' ? node.style.height : 220,
                  }
                : node.style,
          };
        });

        return {
          ...current,
          nodes: nextNodes,
        };
      });
    },
    [selectedNode, updateMachine],
  );

  const handleAddChildNode = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind === 'initial' || selectedNode.data.kind === 'final') {
      return;
    }

    updateMachine((current) => {
      const childNode: StateNode = {
        id: createId('state'),
        type: 'stateNode',
        parentNode: selectedNode.id,
        extent: 'parent',
        position: { x: 60, y: 90 },
        data: {
          label: `Child ${current.nodes.filter((node) => node.parentNode === selectedNode.id).length + 1}`,
          kind: 'atomic',
        },
      };

      const nextNodes = current.nodes.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              style: {
                ...(node.style ?? {}),
                width: typeof node.style?.width === 'number' ? node.style.width : 320,
                height: typeof node.style?.height === 'number' ? node.style.height : 220,
              },
            }
          : node,
      );

      return {
        ...current,
        nodes: [...nextNodes, childNode],
      };
    });
  }, [selectedNode, updateMachine]);

  const handleAutoLayout = useCallback(() => {
    updateMachine((current) => ({
      ...current,
      nodes: autoLayoutNodes(current.nodes, current.edges),
    }));
  }, [updateMachine]);

  const handleLoadExample = useCallback(
    (id: string) => {
      const found = exampleMachines.find((entry) => entry.id === id);
      if (!found) {
        return;
      }

      setSelectedExampleId(id);
      setSelectedNodeId(null);
      setEdgeMenu(null);
      setShowCodePanel(false);
      setJsonDialogMode(null);
      setIsSimulationMode(false);
      setActiveLeafIds([]);
      setActiveEdgeId(null);
      transientHistoryRef.current = null;
      setHistory(createHistoryState(cloneValue(found.machine)));
    },
    [],
  );

  const handleExportJson = useCallback(() => {
    const payload = exportMachineAsXState(machine);
    setJsonPayload(payload);
    setJsonDialogMode('export');
  }, [machine]);

  const handleDownloadExport = useCallback(() => {
    const blob = new Blob([jsonPayload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${machine.machineId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [jsonPayload, machine.machineId]);

  const handleImportSubmit = useCallback(() => {
    try {
      const imported = importMachineFromXState(jsonPayload);
      transientHistoryRef.current = null;
      setHistory(createHistoryState(imported));
      setJsonDialogMode(null);
      setSelectedNodeId(null);
      setEdgeMenu(null);
      setIsSimulationMode(false);
      setActiveLeafIds([]);
      setActiveEdgeId(null);
    } catch (error) {
      window.alert(`Import failed: ${(error as Error).message}`);
    }
  }, [jsonPayload]);

  const handleImportFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    file
      .text()
      .then((text) => {
        setJsonPayload(text);
        setJsonDialogMode('import');
      })
      .catch((error) => {
        window.alert(`Failed to read file: ${(error as Error).message}`);
      });
  }, []);

  const renderNodes = useMemo(
    () =>
      machine.nodes.map((node) => {
        const active = isSimulationMode && isNodeActive(node.id, activeLeafIds, machine);
        const className = [
          node.className ?? '',
          active ? 'rf-node-current' : '',
          connectingFromNodeId === node.id ? 'rf-node-connecting' : '',
        ]
          .join(' ')
          .trim();
        return {
          ...node,
          className,
        };
      }),
    [activeLeafIds, connectingFromNodeId, isSimulationMode, machine],
  );

  const renderEdges = useMemo(
    () =>
      machine.edges.map((edge) => {
        const active = edge.id === activeEdgeId;
        return {
          ...edge,
          type: 'transitionEdge',
          markerEnd: edge.markerEnd ?? ARROW_MARKER,
          className: `${edge.className ?? ''} ${active ? 'rf-edge-active' : ''}`.trim(),
          data: {
            ...edge.data,
            __active: active,
          },
        };
      }),
    [activeEdgeId, machine.edges],
  );

  const parentCandidates = useMemo(
    () =>
      machine.nodes.filter((node) => {
        if (!selectedNode) {
          return false;
        }

        if (node.id === selectedNode.id) {
          return false;
        }

        if (node.data.kind === 'initial' || node.data.kind === 'final') {
          return false;
        }

        return !isDescendant(machine.nodes, node.id, selectedNode.id);
      }),
    [machine.nodes, selectedNode],
  );

  return (
    <SplashScreen>
      <div className="flex h-full w-full flex-col overflow-hidden bg-slate-950 text-slate-100 md:flex-row">
        <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-slate-800 bg-slate-900/80 p-4 md:w-[320px] md:border-b-0 md:border-r">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">FluxState</h1>
            <p className="text-xs text-slate-400">Visual state machine designer and code generator</p>
          </div>

          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <label className="block text-xs uppercase tracking-wide text-slate-400">Examples</label>
            <select
              aria-label="Choose an example machine"
              className={FIELD_CLASS}
              value={selectedExampleId}
              onChange={(event) => handleLoadExample(event.target.value)}
            >
              {exampleMachines.map((example) => (
                <option value={example.id} key={example.id}>
                  {example.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              aria-label="Undo last edit"
              className={BUTTON_SECONDARY_CLASS}
              onClick={undo}
              disabled={!canUndo}
            >
              Undo
            </button>
            <button
              aria-label="Redo last edit"
              className={BUTTON_SECONDARY_CLASS}
              onClick={redo}
              disabled={!canRedo}
            >
              Redo
            </button>
            <button
              aria-label="Auto layout nodes"
              className={BUTTON_SECONDARY_CLASS}
              onClick={handleAutoLayout}
            >
              Auto Layout
            </button>
            <button
              aria-label={isSimulationMode ? 'Stop simulation mode' : 'Start simulation mode'}
              className={
                isSimulationMode
                  ? `${BUTTON_BASE_CLASS} border-emerald-500 bg-emerald-700/30 text-emerald-200 hover:border-emerald-400 hover:bg-emerald-700/45`
                  : BUTTON_SECONDARY_CLASS
              }
              onClick={handleToggleSimulation}
            >
              {isSimulationMode ? 'Stop Sim' : 'Simulate'}
            </button>
            <button
              aria-label={showCodePanel ? 'Hide generated code panel' : 'Show generated code panel'}
              className={BUTTON_SECONDARY_CLASS}
              onClick={() => setShowCodePanel((value) => !value)}
            >
              Generate Code
            </button>
            <button
              aria-label="Export JSON"
              className={BUTTON_SECONDARY_CLASS}
              onClick={handleExportJson}
            >
              Export JSON
            </button>
            <button
              aria-label="Open JSON import dialog"
              className={BUTTON_SECONDARY_CLASS}
              onClick={() => {
                setJsonPayload('');
                setJsonDialogMode('import');
              }}
            >
              Import JSON
            </button>
            <button
              aria-label="Import JSON from file"
              className={BUTTON_SECONDARY_CLASS}
              onClick={() => fileInputRef.current?.click()}
            >
              Import File
            </button>
            <label className="col-span-2 flex cursor-pointer items-center justify-between rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
              <span>Snap to grid</span>
              <input
                aria-label="Toggle snap to grid"
                type="checkbox"
                checked={snapToGrid}
                onChange={(event) => setSnapToGrid(event.target.checked)}
                className="h-4 w-4 accent-cyan-400"
              />
            </label>
          </div>

          <input
            ref={fileInputRef}
            aria-label="Import machine file"
            type="file"
            className="hidden"
            accept="application/json"
            onChange={handleImportFile}
          />

          {isSimulationMode && (
            <div className="space-y-2 rounded-lg border border-emerald-800/70 bg-emerald-950/40 p-3">
              <div className="text-xs uppercase tracking-wide text-emerald-200">Simulation Events</div>
              <div className="flex flex-wrap gap-2">
                {availableEvents.length === 0 && (
                  <div className="text-xs text-slate-300">No outgoing events from active state.</div>
                )}
                {availableEvents.map((eventType) => (
                  <button
                    key={eventType}
                    aria-label={`Trigger simulation event ${eventType}`}
                    className={`${BUTTON_BASE_CLASS} border-emerald-600 bg-emerald-800/40 px-2 py-1 text-xs hover:border-emerald-500 hover:bg-emerald-700/50`}
                    onClick={() => handleSimulationEvent(eventType)}
                  >
                    {eventType}
                  </button>
                ))}
              </div>
              <div className="text-xs text-emerald-200/80">Active: {activeLeafIds.join(', ') || 'none'}</div>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Selection</div>
            {!selectedNode && !selectedEdge && (
              <div className="text-sm text-slate-400">Select a node or right-click an edge to edit.</div>
            )}

            {selectedNode && (
              <div className="space-y-2 overflow-auto pr-1">
                <div className="text-sm font-medium">Node: {selectedNode.id}</div>
                <label className="block text-xs text-slate-300">
                  Label
                  <input
                    aria-label="Node label"
                    value={selectedNode.data.label}
                    onChange={(event) => handleNodePatch({ label: event.target.value })}
                    className={FIELD_COMPACT_CLASS}
                  />
                </label>
                <label className="block text-xs text-slate-300">
                  Kind
                  <select
                    aria-label="Node kind"
                    value={selectedNode.data.kind}
                    onChange={(event) =>
                      handleNodePatch({ kind: event.target.value as StateNode['data']['kind'] })
                    }
                    className={FIELD_COMPACT_CLASS}
                  >
                    <option value="atomic">Atomic</option>
                    <option value="initial">Initial Marker</option>
                    <option value="final">Final Marker</option>
                    <option value="parallel">Parallel Region</option>
                  </select>
                </label>
                <label className="block text-xs text-slate-300">
                  Parent
                  <select
                    aria-label="Parent state"
                    value={selectedNode.parentNode ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      handleNodePatch({ parentNode: value || null });
                    }}
                    className={FIELD_COMPACT_CLASS}
                  >
                    <option value="">(root)</option>
                    {parentCandidates.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.data.label} ({node.id})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  aria-label="Add child state"
                  className={`${BUTTON_PRIMARY_CLASS} w-full px-2 py-1`}
                  onClick={handleAddChildNode}
                >
                  Add Child State
                </button>
              </div>
            )}

            {selectedEdge && !selectedNode && (
              <div className="space-y-2 text-sm text-slate-300">
                <div className="font-medium">Transition: {selectedEdge.id}</div>
                <div>{edgeLabel(selectedEdge)}</div>
                <div className="text-xs text-slate-400">Right-click edge on canvas to edit guard/actions.</div>
              </div>
            )}
          </div>
        </aside>

        <main className="relative min-h-[45vh] flex-1">
          <ReactFlow
            aria-label="State machine canvas"
            nodes={renderNodes}
            edges={renderEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: 'transitionEdge', markerEnd: ARROW_MARKER }}
            connectionLineType={ConnectionLineType.Bezier}
            connectionLineStyle={{ stroke: '#67e8f9', strokeWidth: 2.4 }}
            snapToGrid={snapToGrid}
            snapGrid={SNAP_GRID}
            onInit={setReactFlowInstance}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={(_, params) => setConnectingFromNodeId(params.nodeId ?? null)}
            onConnectEnd={() => setConnectingFromNodeId(null)}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setEdgeMenu(null);
            }}
            onEdgeContextMenu={onEdgeContextMenu}
            onPaneClick={(event) => {
              if (event.detail === 2) {
                createNodeAtPointer(event);
                return;
              }
              setSelectedNodeId(null);
              setEdgeMenu(null);
            }}
            onMoveEnd={(_, viewport) => {
              updateMachine(
                (current) => ({
                  ...current,
                  viewport,
                }),
                'replace',
              );
            }}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            defaultViewport={machine.viewport}
            className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
          >
            <MiniMap
              pannable
              zoomable
              className="!bg-slate-900/80"
              nodeColor={(node) => {
                const kind = (node.data as StateNode['data']).kind;
                if (kind === 'initial') return '#e2e8f0';
                if (kind === 'final') return '#94a3b8';
                if (kind === 'parallel') return '#10b981';
                return '#0ea5e9';
              }}
            />
            <Background color="#334155" gap={24} />
            <Controls className="!border !border-slate-700 !bg-slate-900/80" />
          </ReactFlow>
        </main>

        {edgeMenu && (
          <div
            data-edge-menu
            className="fixed z-20 w-[320px] rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-2xl"
            style={{ left: edgeMenu.x + 6, top: edgeMenu.y + 6 }}
          >
            <div className="mb-2 text-sm font-semibold">Transition Settings</div>
            <label className="mb-2 block text-xs text-slate-300">
              Event
              <input
                aria-label="Transition event name"
                value={edgeEvent}
                onChange={(event) => setEdgeEvent(event.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
              />
            </label>
            <label className="mb-2 block text-xs text-slate-300">
              Guard condition
              <input
                aria-label="Transition guard condition"
                value={edgeGuard}
                onChange={(event) => setEdgeGuard(event.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                placeholder="event.type === 'SUBMIT'"
              />
            </label>
            <label className="mb-3 block text-xs text-slate-300">
              Actions (comma separated)
              <input
                aria-label="Transition actions"
                value={edgeActions}
                onChange={(event) => setEdgeActions(event.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                placeholder="logTransition, notify"
              />
            </label>
            <div className="flex gap-2">
              <button
                aria-label="Save transition settings"
                className={`${BUTTON_PRIMARY_CLASS} flex-1 px-2 py-1`}
                onClick={handleApplyEdgeChanges}
              >
                Save
              </button>
              <button
                aria-label="Delete transition"
                className={`${BUTTON_DANGER_CLASS} px-2 py-1`}
                onClick={handleDeleteEdge}
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {showCodePanel && (
          <div className="fixed inset-x-3 top-3 z-20 h-[80vh] rounded-xl border border-slate-700 bg-slate-900/95 p-3 shadow-2xl md:inset-x-auto md:right-4 md:w-[44vw] md:min-w-[480px]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Generated TypeScript</div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Code generation target"
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                  value={codeTarget}
                  onChange={(event) => setCodeTarget(event.target.value as CodeTarget)}
                >
                  <option value="xstate">XState v5</option>
                  <option value="switch">TypeScript Enum + Switch</option>
                  <option value="zustand">Zustand Store</option>
                </select>
                <button
                  aria-label="Copy generated code"
                  className={`${BUTTON_SECONDARY_CLASS} px-2 py-1 text-xs`}
                  onClick={() => void navigator.clipboard.writeText(generatedCode)}
                >
                  Copy
                </button>
                <button
                  aria-label="Close code panel"
                  className={`${BUTTON_SECONDARY_CLASS} px-2 py-1 text-xs`}
                  onClick={() => setShowCodePanel(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <CodeViewer code={generatedCode} />
          </div>
        )}

        {jsonDialogMode && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/70 p-3">
            <div className="h-[78vh] w-[92vw] max-w-[980px] rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl md:w-[70vw]">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">
                  {jsonDialogMode === 'export' ? 'XState-Compatible JSON Export' : 'Import JSON'}
                </div>
                <button
                  aria-label="Close JSON dialog"
                  className={`${BUTTON_SECONDARY_CLASS} px-2 py-1 text-xs`}
                  onClick={() => setJsonDialogMode(null)}
                >
                  Close
                </button>
              </div>
              <textarea
                aria-label="Machine JSON payload"
                value={jsonPayload}
                onChange={(event) => setJsonPayload(event.target.value)}
                readOnly={jsonDialogMode === 'export'}
                className="h-[calc(100%-4.5rem)] w-full resize-none rounded border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                placeholder="Paste XState JSON here"
              />
              <div className="mt-3 flex justify-end gap-2">
                {jsonDialogMode === 'export' ? (
                  <>
                    <button
                      aria-label="Copy JSON payload"
                      className={`${BUTTON_SECONDARY_CLASS} px-3 py-1 text-xs`}
                      onClick={() => void navigator.clipboard.writeText(jsonPayload)}
                    >
                      Copy JSON
                    </button>
                    <button
                      aria-label="Download JSON payload"
                      className={`${BUTTON_PRIMARY_CLASS} px-3 py-1 text-xs`}
                      onClick={handleDownloadExport}
                    >
                      Download
                    </button>
                  </>
                ) : (
                  <button
                    aria-label="Import JSON payload"
                    className={`${BUTTON_PRIMARY_CLASS} px-3 py-1 text-xs`}
                    onClick={handleImportSubmit}
                  >
                    Import
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </SplashScreen>
  );
}

export default App;

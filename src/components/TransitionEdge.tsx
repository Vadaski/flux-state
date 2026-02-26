import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow';
import type { TransitionData } from '../types/machine';

function edgeLabel(data: TransitionData | undefined): string {
  if (!data) {
    return 'EVENT';
  }

  const parts: string[] = [];

  if (data.event.trim()) {
    parts.push(data.event.trim());
  }

  if (data.guard.trim()) {
    parts.push(`[${data.guard.trim()}]`);
  }

  if (data.actions.length > 0) {
    parts.push(`/ ${data.actions.join(', ')}`);
  }

  return parts.join(' ') || 'EVENT';
}

export function TransitionEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps<TransitionData>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const active = Boolean(data?.__active);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: active ? '#5eead4' : selected ? '#22d3ee' : '#94a3b8',
          strokeWidth: active ? 3.2 : selected ? 2.5 : 2,
        }}
      />
      {active && (
        <path
          d={path}
          fill="none"
          markerEnd={typeof markerEnd === 'string' ? markerEnd : undefined}
          className="rf-edge-flow"
          style={{
            stroke: '#2dd4bf',
            strokeWidth: 3,
            strokeDasharray: '12 8',
            strokeLinecap: 'round',
          }}
        />
      )}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
          className={`pointer-events-none rounded-md border px-2 py-1 text-[10px] font-medium tracking-wide ${
            active
              ? 'border-emerald-300/70 bg-emerald-950/90 text-emerald-100'
              : 'border-slate-700/80 bg-slate-900/90 text-slate-100'
          }`}
        >
          {edgeLabel(data)}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

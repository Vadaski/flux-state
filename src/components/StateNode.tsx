import { Handle, Position, type NodeProps } from 'reactflow';
import type { StateNodeData } from '../types/machine';

const HANDLE_CLASS =
  '!h-3 !w-3 !rounded-full !border-2 !border-slate-900 !bg-cyan-300 transition-opacity duration-150 group-hover:!opacity-100';

function kindBadge(kind: StateNodeData['kind']): string {
  if (kind === 'parallel') {
    return 'parallel';
  }

  if (kind === 'final') {
    return 'final';
  }

  if (kind === 'initial') {
    return 'initial';
  }

  return 'state';
}

export function StateNodeView({ data, selected }: NodeProps<StateNodeData>) {
  const isInitial = data.kind === 'initial';
  const isFinal = data.kind === 'final';
  const isParallel = data.kind === 'parallel';

  if (isInitial) {
    return (
      <div
        className={`group relative h-10 w-10 rounded-full border border-slate-700 bg-slate-100 shadow-lg ${
          selected ? 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-900' : ''
        }`}
      >
        <div className="m-2 h-6 w-6 rounded-full bg-slate-800" />
        <Handle type="source" position={Position.Right} className={`${HANDLE_CLASS} !opacity-100`} />
        <Handle type="source" position={Position.Bottom} className={`${HANDLE_CLASS} !opacity-100`} />
      </div>
    );
  }

  if (isFinal) {
    return (
      <div
        className={`group relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-slate-600 bg-slate-100 shadow-lg ${
          selected ? 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-900' : ''
        }`}
      >
        <div className="h-8 w-8 rounded-full border-2 border-slate-900 bg-slate-900" />
        <Handle type="target" position={Position.Left} className={`${HANDLE_CLASS} !opacity-100`} />
        <Handle type="target" position={Position.Top} className={`${HANDLE_CLASS} !opacity-100`} />
      </div>
    );
  }

  return (
    <div
      className={`group min-w-40 rounded-xl border border-slate-600 bg-slate-900/90 px-3 py-2 text-slate-100 shadow-xl backdrop-blur-sm ${
        selected ? 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-900' : ''
      } ${isParallel ? 'border-dashed border-emerald-400/60 bg-emerald-900/20' : ''}`}
    >
      <div className="mb-1 text-xs uppercase tracking-wide text-cyan-200/80">{kindBadge(data.kind)}</div>
      <div className="text-sm font-semibold">{data.label}</div>
      <Handle type="target" position={Position.Left} className={`${HANDLE_CLASS} !opacity-70`} />
      <Handle type="target" position={Position.Top} className={`${HANDLE_CLASS} !opacity-70`} />
      <Handle type="source" position={Position.Right} className={`${HANDLE_CLASS} !opacity-70`} />
      <Handle type="source" position={Position.Bottom} className={`${HANDLE_CLASS} !opacity-70`} />
    </div>
  );
}

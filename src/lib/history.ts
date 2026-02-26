export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

const MAX_HISTORY = 100;

export function createHistoryState<T>(initial: T): HistoryState<T> {
  return {
    past: [],
    present: initial,
    future: [],
  };
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function withHistoryPush<T>(state: HistoryState<T>, next: T): HistoryState<T> {
  const serializedCurrent = JSON.stringify(state.present);
  const serializedNext = JSON.stringify(next);

  if (serializedCurrent === serializedNext) {
    return state;
  }

  const past = [...state.past, cloneValue(state.present)].slice(-MAX_HISTORY);

  return {
    past,
    present: cloneValue(next),
    future: [],
  };
}

export function withHistoryPushFromSnapshot<T>(
  state: HistoryState<T>,
  snapshot: T,
  next: T,
): HistoryState<T> {
  const serializedSnapshot = JSON.stringify(snapshot);
  const serializedNext = JSON.stringify(next);

  if (serializedSnapshot === serializedNext) {
    return withHistoryReplace(state, next);
  }

  const past = [...state.past, cloneValue(snapshot)].slice(-MAX_HISTORY);

  return {
    past,
    present: cloneValue(next),
    future: [],
  };
}

export function withHistoryReplace<T>(state: HistoryState<T>, next: T): HistoryState<T> {
  return {
    ...state,
    present: cloneValue(next),
  };
}

export function undoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.past.length === 0) {
    return state;
  }

  const prev = state.past[state.past.length - 1];

  return {
    past: state.past.slice(0, -1),
    present: cloneValue(prev),
    future: [cloneValue(state.present), ...state.future],
  };
}

export function redoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.future.length === 0) {
    return state;
  }

  const next = state.future[0];

  return {
    past: [...state.past, cloneValue(state.present)].slice(-MAX_HISTORY),
    present: cloneValue(next),
    future: state.future.slice(1),
  };
}

import type { MachineDocument, StateNode, TransitionEdge } from '../types/machine';
import { MarkerType } from 'reactflow';

function node(
  id: string,
  label: string,
  kind: StateNode['data']['kind'],
  x: number,
  y: number,
  parentNode?: string,
  width?: number,
  height?: number,
): StateNode {
  return {
    id,
    type: 'stateNode',
    position: { x, y },
    parentNode,
    extent: parentNode ? 'parent' : undefined,
    style: width && height ? { width, height } : undefined,
    data: {
      label,
      kind,
    },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  event: string,
  guard = '',
  actions: string[] = [],
): TransitionEdge {
  return {
    id,
    type: 'transitionEdge',
    source,
    target,
    markerEnd: { type: MarkerType.ArrowClosed },
    data: {
      event,
      guard,
      actions,
    },
  };
}

export const trafficLightMachine: MachineDocument = {
  version: 1,
  machineId: 'trafficLight',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    node('tl_init', 'Initial', 'initial', 40, 165),
    node('red', 'Red', 'atomic', 220, 140),
    node('green', 'Green', 'atomic', 460, 140),
    node('yellow', 'Yellow', 'atomic', 700, 140),
  ],
  edges: [
    edge('e_tl_init_red', 'tl_init', 'red', 'INIT'),
    edge('e_tl_red_green', 'red', 'green', 'TIMER', '', ['startGoTimer']),
    edge('e_tl_green_yellow', 'green', 'yellow', 'TIMER', '', ['warnDrivers']),
    edge('e_tl_yellow_red', 'yellow', 'red', 'TIMER', '', ['stopTraffic']),
  ],
};

export const authFlowMachine: MachineDocument = {
  version: 1,
  machineId: 'authFlow',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    node('auth_init', 'Initial', 'initial', 40, 160),
    node('logged_out', 'Logged Out', 'atomic', 220, 120),
    node('authenticating', 'Authenticating', 'atomic', 430, 120),
    node('logged_in', 'Logged In', 'atomic', 670, 120),
    node('denied', 'Denied', 'final', 430, 300),
  ],
  edges: [
    edge('e_auth_init_out', 'auth_init', 'logged_out', 'INIT'),
    edge('e_out_login', 'logged_out', 'authenticating', 'LOGIN', '', ['requestToken']),
    edge(
      'e_auth_success',
      'authenticating',
      'logged_in',
      'AUTH_SUCCESS',
      "event.type === 'AUTH_SUCCESS'",
      ['saveSession'],
    ),
    edge('e_auth_fail', 'authenticating', 'denied', 'AUTH_FAIL', '', ['captureError']),
    edge('e_logout', 'logged_in', 'logged_out', 'LOGOUT', '', ['clearSession']),
  ],
};

export const checkoutMachine: MachineDocument = {
  version: 1,
  machineId: 'checkoutFlow',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    node('co_init', 'Initial', 'initial', 30, 210),
    node('cart', 'Cart', 'atomic', 190, 180),
    node('review', 'Review (Parallel)', 'parallel', 420, 80, undefined, 520, 320),
    node('review_shipping', 'Shipping', 'atomic', 40, 70, 'review'),
    node('review_payment', 'Payment', 'atomic', 260, 70, 'review'),
    node('review_init_shipping', 'Initial', 'initial', 18, 22, 'review'),
    node('confirm', 'Confirm', 'atomic', 1020, 180),
    node('done', 'Done', 'final', 1240, 180),
  ],
  edges: [
    edge('e_co_init_cart', 'co_init', 'cart', 'INIT'),
    edge('e_cart_review', 'cart', 'review', 'BEGIN_CHECKOUT', '', ['lockInventory']),
    edge('e_review_init_shipping', 'review_init_shipping', 'review_shipping', 'INIT'),
    edge('e_shipping_payment', 'review_shipping', 'review_payment', 'SHIPPING_OK'),
    edge('e_payment_confirm', 'review_payment', 'confirm', 'PAYMENT_OK', 'true', ['capturePayment']),
    edge('e_confirm_done', 'confirm', 'done', 'PLACE_ORDER', '', ['emitOrderPlaced']),
  ],
};

export const exampleMachines = [
  { id: 'traffic', name: 'Traffic Light', machine: trafficLightMachine },
  { id: 'auth', name: 'Auth Flow', machine: authFlowMachine },
  { id: 'checkout', name: 'Shopping Cart', machine: checkoutMachine },
] as const;

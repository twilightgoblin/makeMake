// -----------------------------------------------------------------------------
// Click-wheel gesture system
//
// Handles two distinct gesture surfaces:
//
//   1. WHEEL RING  — The outer donut ring. Tracks pointer/touch angle to emit
//      rotation deltas. One full 360° rotation = ~20 scroll steps.
//
//   2. CENTER BUTTON — Simple press, handled directly in React (not here).
//
// Swipe gestures (up/down/left/right) are detected on the screen element
// rather than the wheel, so they feel natural (swipe up on screen → go back).
//
// Usage:
//   const cleanup = attachWheelListeners(ringEl, { onRotate, onTap });
//   const cleanup = attachScreenSwipe(screenEl, { onSwipe });
// -----------------------------------------------------------------------------

export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

export interface WheelCallbacks {
  /** delta > 0 = clockwise (scroll down), delta < 0 = counter-clockwise (scroll up) */
  onRotate: (delta: number) => void;
  /** Tapped the outer ring without meaningful rotation */
  onTap?: () => void;
}

export interface SwipeCallbacks {
  onSwipe: (dir: SwipeDirection) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Degrees of arc that produce 1 scroll step */
const DEGREES_PER_STEP = 18;

/** Minimum pointer travel (px) to distinguish swipe from tap on the screen */
const SWIPE_THRESHOLD = 30;

/** Below this angular movement (degrees), treat pointer-up as a tap */
const TAP_MAX_DEGREES = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAngleDeg(cx: number, cy: number, x: number, y: number): number {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}

function normalizeAngleDelta(delta: number): number {
  // Keep delta in (-180, 180] to avoid wrap-around jumps
  let d = delta % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function clientXY(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('touches' in e) {
    const t = e.touches[0] ?? e.changedTouches[0];
    return { x: t.clientX, y: t.clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

// ---------------------------------------------------------------------------
// Wheel ring rotation tracker
// ---------------------------------------------------------------------------

export function attachWheelListeners(
  el: HTMLElement,
  callbacks: WheelCallbacks,
): () => void {
  let tracking = false;
  let cx = 0;
  let cy = 0;
  let prevAngle = 0;
  let accumDeg = 0;   // accumulated degrees since pointer-down, for tap detection
  let residual = 0;   // sub-step carry-over

  const getCenter = () => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  };

  const onStart = (e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    const { x, y } = clientXY(e);
    const center = getCenter();
    cx = center.cx;
    cy = center.cy;
    prevAngle = getAngleDeg(cx, cy, x, y);
    accumDeg = 0;
    residual = 0;
    tracking = true;
  };

  const onMove = (e: MouseEvent | TouchEvent) => {
    if (!tracking) return;
    e.preventDefault();
    const { x, y } = clientXY(e);
    const angle = getAngleDeg(cx, cy, x, y);
    const rawDelta = normalizeAngleDelta(angle - prevAngle);
    prevAngle = angle;
    accumDeg += Math.abs(rawDelta);

    residual += rawDelta;
    const steps = Math.trunc(residual / DEGREES_PER_STEP);
    residual -= steps * DEGREES_PER_STEP;

    if (steps !== 0) {
      callbacks.onRotate(steps);
    }
  };

  const onEnd = () => {
    if (!tracking) return;
    tracking = false;
    if (accumDeg <= TAP_MAX_DEGREES) {
      callbacks.onTap?.();
    }
  };

  el.addEventListener('mousedown', onStart, { passive: false });
  el.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('mousemove', onMove, { passive: false });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchend', onEnd);

  return () => {
    el.removeEventListener('mousedown', onStart);
    el.removeEventListener('touchstart', onStart);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('mouseup', onEnd);
    window.removeEventListener('touchend', onEnd);
  };
}

// ---------------------------------------------------------------------------
// Screen swipe detector
// ---------------------------------------------------------------------------

export function attachScreenSwipe(
  el: HTMLElement,
  callbacks: SwipeCallbacks,
): () => void {
  let startX = 0;
  let startY = 0;

  const onStart = (e: MouseEvent | TouchEvent) => {
    const { x, y } = clientXY(e);
    startX = x;
    startY = y;
  };

  const onEnd = (e: MouseEvent | TouchEvent) => {
    const { x, y } = clientXY(e);
    const dx = x - startX;
    const dy = y - startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (Math.max(adx, ady) < SWIPE_THRESHOLD) return;

    if (adx > ady) {
      callbacks.onSwipe(dx > 0 ? 'right' : 'left');
    } else {
      callbacks.onSwipe(dy > 0 ? 'down' : 'up');
    }
  };

  el.addEventListener('mousedown', onStart);
  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('mouseup', onEnd);
  el.addEventListener('touchend', onEnd, { passive: true });

  return () => {
    el.removeEventListener('mousedown', onStart);
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('mouseup', onEnd);
    el.removeEventListener('touchend', onEnd);
  };
}

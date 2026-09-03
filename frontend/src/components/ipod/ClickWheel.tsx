// -----------------------------------------------------------------------------
// ClickWheel — the physical click wheel component
//
// Renders the outer ring (rotation gesture surface), the inner ring cutout,
// and the center button. The four cardinal button labels (MENU, ▶▶|, |◀◀, ▶/❚❚)
// sit on the outer ring in the top/bottom/left/right positions.
//
// Gesture detection is handled by gestures.ts. This component wires the
// DOM element to the gesture system via a useEffect.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { attachWheelListeners } from './gestures';

export interface ClickWheelProps {
  onRotate: (delta: number) => void;
  onCenterClick: () => void;
  onMenuClick: () => void;
  onNextClick: () => void;
  onPrevClick: () => void;
  onPlayPauseClick: () => void;
  /** Disable playback control buttons (MEMBER in room mode) */
  controlsLocked?: boolean;
}

export function ClickWheel({
  onRotate,
  onCenterClick,
  onMenuClick,
  onNextClick,
  onPrevClick,
  onPlayPauseClick,
  controlsLocked = false,
}: ClickWheelProps) {
  const ringRef = useRef<HTMLDivElement>(null);
  const [glowing, setGlowing] = useState(false);

  // Attach wheel rotation gesture to the outer ring element
  useEffect(() => {
    const el = ringRef.current;
    if (!el) return;

    const cleanup = attachWheelListeners(el, {
      onRotate: (delta) => {
        // Flash ring
        setGlowing(true);
        setTimeout(() => setGlowing(false), 400);
        onRotate(delta);
      },
    });

    return cleanup;
  }, [onRotate]);

  return (
    <div
      className="click-wheel"
      aria-label="Click wheel"
      role="group"
    >
      {/* Outer ring — gesture surface */}
      <div
        ref={ringRef}
        className={`wheel-outer${glowing ? ' wheel-outer--active' : ''}`}
        aria-hidden="true"
      />

      {/* Inner ring visual cutout */}
      <div className="wheel-inner-cutout" aria-hidden="true" />

      {/* MENU — top */}
      <button
        className="wheel-btn wheel-btn--top"
        onClick={onMenuClick}
        aria-label="Menu"
        title="Menu / Back"
      >
        <span className="wheel-btn-icon" style={{ fontSize: 8, letterSpacing: '0.04em', fontWeight: 700 }}>
          MENU
        </span>
      </button>

      {/* |◀◀ — left */}
      <button
        className="wheel-btn wheel-btn--left"
        onClick={onPrevClick}
        aria-label="Previous"
        title="Previous track"
      >
        <span className="wheel-btn-icon">⏮</span>
      </button>

      {/* ▶▶| — right */}
      <button
        className="wheel-btn wheel-btn--right"
        onClick={onNextClick}
        aria-label="Next"
        title="Next track"
      >
        <span className="wheel-btn-icon">⏭</span>
      </button>

      {/* ▶/❚❚ — bottom */}
      <button
        className={`wheel-btn wheel-btn--bottom${controlsLocked ? ' wheel-btn--locked' : ''}`}
        onClick={onPlayPauseClick}
        aria-label="Play / Pause"
        title={controlsLocked ? 'Host controls playback' : 'Play / Pause'}
        aria-disabled={controlsLocked}
      >
        <span className="wheel-btn-icon">▶</span>
      </button>

      {/* Center SELECT button */}
      <button
        className="wheel-center-btn"
        onClick={onCenterClick}
        aria-label="Select"
        title="Select"
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Makemake — HomePage
//
// Three sub-views rendered in place (no extra routes):
//
//   'landing'  — choose Create Room or Join Room
//   'create'   — name input → POST /rooms → navigate to /room/:code
//   'join'     — name + code input → POST join-request → poll for status
//   'waiting'  — show "Waiting for host approval…" while polling
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom, createJoinRequest, getJoinRequestStatus, ApiError } from '../lib/api';
import type { LocalParticipant } from '../types';

type View = 'landing' | 'create' | 'join' | 'waiting';

const POLL_INTERVAL_MS = 2000;

export function HomePage() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('landing');

  // ── Create form ────────────────────────────────────────────────────────────
  const [createName, setCreateName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const name = createName.trim();
    if (!name) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const data = await createRoom(name);
      const identity: LocalParticipant = {
        id: data.participant.id,
        displayName: data.participant.displayName,
        role: data.participant.role,
        roomId: data.room.id,
        roomCode: data.room.code,
      };
      sessionStorage.setItem('participant', JSON.stringify(identity));
      void navigate(`/room/${data.room.code}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Could not create room.');
    } finally {
      setCreateLoading(false);
    }
  }, [createName, navigate]);

  // ── Join form ──────────────────────────────────────────────────────────────
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Polling state — set after a join request is created
  const [pendingRoomCode, setPendingRoomCode] = useState('');
  const [pendingRequestId, setPendingRequestId] = useState('');
  const [pendingDisplayName, setPendingDisplayName] = useState('');
  const [pollError, setPollError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollActiveRef = useRef(false);

  const handleJoin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const name = joinName.trim();
    const code = joinCode.trim().toUpperCase();
    if (!name || !code) return;
    setJoinLoading(true);
    setJoinError(null);
    try {
      const data = await createJoinRequest(code, name);
      setPendingRoomCode(code);
      setPendingRequestId(data.joinRequest.id);
      setPendingDisplayName(name);
      setView('waiting');
    } catch (err) {
      setJoinError(err instanceof ApiError ? err.message : 'Could not send join request.');
    } finally {
      setJoinLoading(false);
    }
  }, [joinName, joinCode]);

  // ── Polling ────────────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    pollActiveRef.current = false;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!pollActiveRef.current) return;
    try {
      const data = await getJoinRequestStatus(pendingRoomCode, pendingRequestId);
      const { status } = data.joinRequest;

      if (status === 'ACCEPTED') {
        // The GET status endpoint looks up the participant by displayName after
        // acceptance. There's a small race window where the PATCH transaction
        // has committed but the DB read hasn't caught up — retry once.
        let participant = data.participant;
        if (!participant) {
          await new Promise((r) => setTimeout(r, 500));
          const retry = await getJoinRequestStatus(pendingRoomCode, pendingRequestId);
          participant = retry.participant;
        }

        if (!participant?.id || !participant?.roomId) {
          // Still no participant — keep polling; it'll resolve on the next tick.
          if (pollActiveRef.current) {
            pollTimerRef.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
          }
          return;
        }

        stopPolling();
        const resolvedIdentity: LocalParticipant = {
          id: participant.id,
          displayName: data.joinRequest.displayName,
          role: (participant.role ?? 'MEMBER') as import('../types').ParticipantRole,
          roomId: participant.roomId,
          roomCode: pendingRoomCode,
        };
        // Store as 'participant' directly — RoomPage reads this key on both paths.
        sessionStorage.setItem('participant', JSON.stringify(resolvedIdentity));
        void navigate(`/room/${pendingRoomCode}?joining=1`);
        return;
      }

      if (status === 'REJECTED') {
        stopPolling();
        setPollError('Your request was rejected by the host.');
        setView('join');
        return;
      }

      // Still PENDING — schedule next poll
      if (pollActiveRef.current) {
        pollTimerRef.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    } catch (err) {
      if (pollActiveRef.current) {
        // Transient error — keep polling
        pollTimerRef.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
      console.warn('[poll] error', err);
    }
  }, [pendingRoomCode, pendingRequestId, pendingDisplayName, stopPolling, navigate]);

  useEffect(() => {
    if (view === 'waiting' && pendingRequestId) {
      pollActiveRef.current = true;
      pollTimerRef.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      return () => stopPolling();
    }
  }, [view, pendingRequestId, poll, stopPolling]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (view === 'landing') {
    return (
      <div className="home-screen">
        <div className="home-card">
          <div className="home-logo">♪</div>
          <h1 className="home-title">Makemake</h1>
          <p className="home-subtitle">Listen together, in sync.</p>
          <div className="home-actions">
            <button
              className="btn btn--primary btn--full"
              onClick={() => setView('create')}
            >
              Create Room
            </button>
            <button
              className="btn btn--ghost btn--full"
              onClick={() => setView('join')}
            >
              Join Room
            </button>
            <button
              className="btn btn--ghost btn--full"
              onClick={() => void navigate('/solo')}
            >
              Solo Mode
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'create') {
    return (
      <div className="home-screen">
        <div className="home-card">
          <button
            className="home-back"
            onClick={() => { setCreateError(null); setView('landing'); }}
            aria-label="Back"
          >
            ← Back
          </button>
          <h2 className="home-heading">Create Room</h2>
          <form className="home-form" onSubmit={(e) => void handleCreate(e)}>
            <label className="form-label" htmlFor="create-name">Your name</label>
            <input
              id="create-name"
              className="form-input"
              type="text"
              placeholder="e.g. Ayush"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              maxLength={32}
              autoFocus
              autoComplete="off"
            />
            {createError && <p className="form-error">{createError}</p>}
            <button
              className="btn btn--primary btn--full"
              type="submit"
              disabled={createLoading || !createName.trim()}
            >
              {createLoading ? 'Creating…' : 'Create Room'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (view === 'join') {
    return (
      <div className="home-screen">
        <div className="home-card">
          <button
            className="home-back"
            onClick={() => { setJoinError(null); setPollError(null); setView('landing'); }}
            aria-label="Back"
          >
            ← Back
          </button>
          <h2 className="home-heading">Join Room</h2>
          <form className="home-form" onSubmit={(e) => void handleJoin(e)}>
            <label className="form-label" htmlFor="join-name">Your name</label>
            <input
              id="join-name"
              className="form-input"
              type="text"
              placeholder="e.g. Alex"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              maxLength={32}
              autoFocus
              autoComplete="off"
            />
            <label className="form-label" htmlFor="join-code">Room code</label>
            <input
              id="join-code"
              className="form-input form-input--mono"
              type="text"
              placeholder="e.g. ABC123"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={8}
              autoComplete="off"
            />
            {pollError && <p className="form-error">{pollError}</p>}
            {joinError && <p className="form-error">{joinError}</p>}
            <button
              className="btn btn--primary btn--full"
              type="submit"
              disabled={joinLoading || !joinName.trim() || !joinCode.trim()}
            >
              {joinLoading ? 'Sending request…' : 'Request to Join'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // view === 'waiting'
  return (
    <div className="home-screen">
      <div className="home-card home-card--waiting">
        <div className="waiting-spinner" aria-hidden="true" />
        <h2 className="home-heading">Waiting for approval</h2>
        <p className="waiting-text">
          The host will let you in shortly.
        </p>
        <p className="waiting-code">
          Room <span className="waiting-code-value">{pendingRoomCode}</span>
        </p>
        <button
          className="btn btn--ghost"
          onClick={() => {
            stopPolling();
            setView('join');
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

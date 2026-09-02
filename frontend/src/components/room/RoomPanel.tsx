// -----------------------------------------------------------------------------
// RoomPanel — left social panel for the room page
//
// Sections (top to bottom):
//   1. Participants list (online/offline, host badge)
//   2. Join requests (HOST only, when pending)
//   3. Chat (messages + input, full height fill)
//
// Chat messages are received via WS CHAT_MESSAGE events. The panel manages
// its own message list state; the parent passes `onSendMessage` and
// `chatMessages` as props.
// -----------------------------------------------------------------------------

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { resolveJoinRequest } from '../../lib/api';
import type { Participant, PendingJoinRequest } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  senderName: string;
  senderId: string;
  content: string;
  sentAt: string;
}

interface ParticipantsSectionProps {
  participants: Participant[];
  selfId: string;
}

interface JoinRequestsSectionProps {
  requests: PendingJoinRequest[];
  roomId: string;
  participantId: string;
  onResolved: (requestId: string) => void;
}

interface ChatSectionProps {
  messages: ChatMessage[];
  selfId: string;
  onSend: (content: string) => void;
}

export interface RoomPanelProps {
  participants: Participant[];
  selfId: string;
  isHost: boolean;
  pendingRequests: PendingJoinRequest[];
  roomId: string;
  participantId: string;
  onRequestResolved: (requestId: string) => void;
  chatMessages: ChatMessage[];
  onSendMessage: (content: string) => void;
  roomCode: string;
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

function ParticipantsSection({ participants, selfId }: ParticipantsSectionProps) {
  return (
    <div className="room-panel-section">
      <p className="room-panel-heading">People</p>
      <ul className="participant-list" role="list">
        {participants.map((p) => {
          const online = p.isOnline !== false;
          const isHost = p.role === 'HOST';
          return (
            <li key={p.id} className="participant-item">
              <span
                className={`participant-dot${online ? '' : ' participant-dot--offline'}`}
                aria-label={online ? 'online' : 'offline'}
                title={online ? 'Online' : 'Offline'}
              />
              <span className="participant-name">
                {p.displayName}
                {p.id === selfId ? ' (you)' : ''}
              </span>
              {isHost && (
                <span className="participant-host-badge" aria-label="Host">
                  HOST
                </span>
              )}
            </li>
          );
        })}
        {participants.length === 0 && (
          <li style={{ fontSize: 12, color: 'var(--text-placeholder)' }}>—</li>
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Join requests (HOST only)
// ---------------------------------------------------------------------------

function JoinRequestsSection({
  requests,
  roomId,
  participantId,
  onResolved,
}: JoinRequestsSectionProps) {
  const [resolving, setResolving] = useState<Record<string, boolean>>({});

  const handle = useCallback(
    async (requestId: string, action: 'ACCEPT' | 'REJECT') => {
      setResolving((prev) => ({ ...prev, [requestId]: true }));
      try {
        await resolveJoinRequest(roomId, requestId, action, participantId);
        onResolved(requestId);
      } catch (err) {
        console.error('[join-request] resolve failed', err);
      } finally {
        setResolving((prev) => ({ ...prev, [requestId]: false }));
      }
    },
    [roomId, participantId, onResolved],
  );

  if (requests.length === 0) return null;

  return (
    <div className="room-panel-section">
      <p className="room-panel-heading">Requests ({requests.length})</p>
      {requests.map((r) => (
        <div key={r.id} className="join-request-item">
          <span className="join-request-name">{r.displayName}</span>
          <div className="join-request-actions">
            <button
              className="join-request-btn join-request-btn--accept"
              disabled={resolving[r.id]}
              onClick={() => void handle(r.id, 'ACCEPT')}
              aria-label={`Accept ${r.displayName}`}
            >
              ✓
            </button>
            <button
              className="join-request-btn join-request-btn--reject"
              disabled={resolving[r.id]}
              onClick={() => void handle(r.id, 'REJECT')}
              aria-label={`Reject ${r.displayName}`}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function ChatSection({ messages, selfId, onSend }: ChatSectionProps) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const submit = useCallback(() => {
    const content = draft.trim();
    if (!content) return;
    onSend(content);
    setDraft('');
    inputRef.current?.focus();
  }, [draft, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <>
      <div className="chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
        {messages.length === 0 && (
          <div className="chat-empty">No messages yet</div>
        )}
        {messages.map((msg) => {
          const isSelf = msg.senderId === selfId;
          return (
            <div key={msg.id} className="chat-message">
              <span className={`chat-message-sender${isSelf ? ' chat-message-sender--self' : ''}`}>
                {isSelf ? 'You' : msg.senderName}
              </span>
              <span className="chat-message-content">{msg.content}</span>
            </div>
          );
        })}
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Message…"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Chat message"
          maxLength={500}
        />
        <button
          className="chat-send-btn"
          onClick={submit}
          disabled={!draft.trim()}
          aria-label="Send message"
        >
          Send
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// RoomPanel (root export)
// ---------------------------------------------------------------------------

export function RoomPanel({
  participants,
  selfId,
  isHost,
  pendingRequests,
  roomId,
  participantId,
  onRequestResolved,
  chatMessages,
  onSendMessage,
  roomCode,
}: RoomPanelProps) {
  return (
    <aside className="room-panel" aria-label="Room panel">
      {/* Room code at top */}
      <div className="room-panel-section" style={{ paddingBottom: 12 }}>
        <p className="room-panel-heading">Room</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="room-code-badge"
            title="Share this code to invite people"
            style={{ cursor: 'default' }}
          >
            {roomCode}
          </span>
          <button
            className="btn btn--ghost btn--sm"
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={() => void navigator.clipboard?.writeText(roomCode)}
            title="Copy room code"
            aria-label="Copy room code"
          >
            Copy
          </button>
        </div>
      </div>

      <ParticipantsSection participants={participants} selfId={selfId} />

      {isHost && (
        <JoinRequestsSection
          requests={pendingRequests}
          roomId={roomId}
          participantId={participantId}
          onResolved={onRequestResolved}
        />
      )}

      {/* Chat fills the remaining vertical space */}
      <div className="room-panel-section" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '12px 0 0', overflow: 'hidden' }}>
        <p className="room-panel-heading" style={{ paddingLeft: 18, marginBottom: 0 }}>Chat</p>
      </div>
      <ChatSection
        messages={chatMessages}
        selfId={selfId}
        onSend={onSendMessage}
      />
    </aside>
  );
}

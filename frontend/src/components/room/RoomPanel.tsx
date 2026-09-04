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

export interface FloatingJoinRequestsProps {
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
// Floating join requests (HOST only)
// ---------------------------------------------------------------------------

export function FloatingJoinRequests({
  requests,
  roomId,
  participantId,
  onResolved,
}: FloatingJoinRequestsProps) {
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
    <div className="floating-requests-container">
      <div className="floating-requests-header">
        Requests ({requests.length})
      </div>
      <div className="floating-requests-list">
        {requests.map((r) => (
          <div key={r.id} className="floating-request-item">
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
  isHost: _isHost,
  roomId: _roomId,
  participantId: _participantId,
  onRequestResolved: _onRequestResolved,
  chatMessages,
  onSendMessage,
  roomCode,
}: RoomPanelProps) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(roomCode);
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
    }, 4000);
  }, [roomCode]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

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
            style={{ padding: '3px 8px', fontSize: 11, minWidth: 46 }}
            onClick={handleCopy}
            title="Copy room code"
            aria-label="Copy room code"
          >
            {copied ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="copy-tick-svg"
                style={{ color: 'var(--success)' }}
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              'Copy'
            )}
          </button>
        </div>
      </div>

      <ParticipantsSection participants={participants} selfId={selfId} />

      {/* Chat fills the remaining vertical space */}
      <div className="room-panel-section" style={{ padding: '12px 0 0', borderBottom: 'none' }}>
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

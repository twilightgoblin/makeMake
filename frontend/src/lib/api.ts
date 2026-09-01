// -----------------------------------------------------------------------------
// Makemake — typed HTTP API client
//
// Thin wrappers around fetch. Every function:
//   - throws an ApiError on non-2xx responses
//   - returns a typed response shape matching the backend contract
// -----------------------------------------------------------------------------

import type {
  CreateRoomResponse,
  JoinRequestResponse,
  JoinRequestStatusResponse,
  ResolveJoinRequestResponse,
  RoomDetail,
  SongsResponse,
} from '../types';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers: extraHeaders, ...restInit } = init ?? {};
  const res = await fetch(path, {
    ...restInit,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

  if (!res.ok) {
    let code = 'UNKNOWN';
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // ignore parse errors — use defaults above
    }
    throw new ApiError(res.status, code, message);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------

export function fetchSongs(params: {
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<SongsResponse> {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.offset !== undefined) q.set('offset', String(params.offset));
  if (params.search?.trim()) q.set('search', params.search.trim());
  return request<SongsResponse>(`/songs?${q.toString()}`);
}

// ---------------------------------------------------------------------------
// Rooms — creation
// ---------------------------------------------------------------------------

/** POST /rooms — create a room and become its HOST. */
export function createRoom(displayName: string): Promise<CreateRoomResponse> {
  return request<CreateRoomResponse>('/rooms', {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  });
}

// ---------------------------------------------------------------------------
// Rooms — detail (hydration)
// ---------------------------------------------------------------------------

/**
 * GET /rooms/:id — fetch full room state.
 * Requires X-Participant-Id header (caller must be an active participant).
 */
export function getRoomDetail(roomId: string, participantId: string): Promise<{ room: RoomDetail }> {
  return request<{ room: RoomDetail }>(`/rooms/${roomId}`, {
    headers: { 'X-Participant-Id': participantId },
  });
}

// ---------------------------------------------------------------------------
// Join requests
// ---------------------------------------------------------------------------

/**
 * POST /rooms/:code/join-requests — guest submits a join request.
 * No participant identity required.
 */
export function createJoinRequest(
  roomCode: string,
  displayName: string,
): Promise<JoinRequestResponse> {
  return request<JoinRequestResponse>(`/rooms/${roomCode}/join-requests`, {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  });
}

/**
 * GET /rooms/:code/join-requests/:id — poll join request status.
 * No authentication required.
 */
export function getJoinRequestStatus(
  roomCode: string,
  requestId: string,
): Promise<JoinRequestStatusResponse> {
  return request<JoinRequestStatusResponse>(
    `/rooms/${roomCode}/join-requests/${requestId}`,
  );
}

/**
 * PATCH /rooms/:id/join-requests/:requestId — HOST accepts or rejects.
 * Requires X-Participant-Id header (must be HOST).
 */
export function resolveJoinRequest(
  roomId: string,
  requestId: string,
  action: 'ACCEPT' | 'REJECT',
  participantId: string,
): Promise<ResolveJoinRequestResponse> {
  return request<ResolveJoinRequestResponse>(
    `/rooms/${roomId}/join-requests/${requestId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ action }),
      headers: { 'X-Participant-Id': participantId },
    },
  );
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

/**
 * PATCH /rooms/:id/participants/:participantId/leave — participant leaves.
 * Requires X-Participant-Id header matching participantId.
 */
export function leaveRoom(roomId: string, participantId: string): Promise<void> {
  return request<void>(
    `/rooms/${roomId}/participants/${participantId}/leave`,
    {
      method: 'PATCH',
      headers: { 'X-Participant-Id': participantId },
    },
  );
}

/**
 * DELETE /rooms/:id — HOST closes the room.
 * Requires X-Participant-Id header (must be HOST).
 */
export function closeRoom(roomId: string, participantId: string): Promise<void> {
  return request<void>(`/rooms/${roomId}`, {
    method: 'DELETE',
    headers: { 'X-Participant-Id': participantId },
  });
}

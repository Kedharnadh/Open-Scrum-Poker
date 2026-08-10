function normalizeVoteEntry(item, fallbackId = '') {
  return {
    id: item?.id || fallbackId || '',
    name: item?.name || '',
    vote: item?.vote ?? null,
  };
}

export function toVoteEntries(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeVoteEntry(item))
      .filter((item) => item.id);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([id, item]) => normalizeVoteEntry(item, id))
      .filter((item) => item.id);
  }
  return [];
}

function normalizeParticipant(item, id) {
  return {
    id,
    name: item?.name || '',
    online: item?.online !== false,
    lastSeen: item?.lastSeen || 0,
  };
}

export function toParticipantMap(value) {
  const map = {};
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item?.id) {
        map[item.id] = normalizeParticipant(item, item.id);
      }
    }
  } else if (value && typeof value === 'object') {
    for (const [id, item] of Object.entries(value)) {
      map[id] = normalizeParticipant(item, id);
    }
  }
  return map;
}

export function upsertVoteEntry(votes, entry) {
  const nextVotes = toVoteEntries(votes).filter((item) => item.id !== entry.id);
  return [...nextVotes, entry];
}

export function removeParticipantVote(votes, participantId) {
  return toVoteEntries(votes).filter((item) => item.id !== participantId);
}

export function dedupeVotesByName(votes, name) {
  const entries = toVoteEntries(votes);
  const normalizedName = (name || '').trim();
  if (!normalizedName) {
    return entries;
  }
  return entries.filter((entry) => (entry?.name || '').trim() !== normalizedName);
}

export function isRoomExpired(roomState, now = Date.now()) {
  return Boolean(roomState?.expiresAt) && roomState.expiresAt < now;
}

export function normalizeRoomState(payload) {
  const source = payload || {};
  return {
    roomCode: source.roomCode || source.room_code || '',
    roomTitle: source.roomTitle || source.room_title || 'Sprint Planning',
    selectedScaleId: source.selectedScaleId || source.selected_scale_id || '',
    revealed: Boolean(source.revealed),
    hostOnly: Boolean(source.hostOnly || source.host_only),
    hostId: source.hostId || source.host_id || '',
    expiresAt: Number.isFinite(source.expiresAt)
      ? source.expiresAt
      : Number.isFinite(source.expires_at)
        ? source.expires_at
        : 0,
    updatedAt: Number.isFinite(source.updatedAt)
      ? source.updatedAt
      : Number.isFinite(source.updated_at)
        ? source.updated_at
        : 0,
    votes: toVoteEntries(source.votes),
    participants: toParticipantMap(source.participants),
  };
}

export function createRoomState(roomCode, overrides = {}) {
  return normalizeRoomState({
    roomCode,
    roomTitle: overrides.roomTitle || 'Sprint Planning',
    selectedScaleId: overrides.selectedScaleId || '',
    revealed: overrides.revealed ?? false,
    hostOnly: overrides.hostOnly ?? false,
    hostId: overrides.hostId || '',
    expiresAt: overrides.expiresAt || 0,
    updatedAt: overrides.updatedAt || 0,
    votes: overrides.votes || [],
    participants: overrides.participants || {},
  });
}

export function resolveRoomState(localRoomState, remoteRoomState) {
  const localRoom = normalizeRoomState(localRoomState);
  const remoteRoom = normalizeRoomState(remoteRoomState);

  if (!remoteRoom.roomCode) {
    return localRoom;
  }

  const hasRemoteField = (camelCase, snakeCase) => {
    const raw = remoteRoomState?.[camelCase] ?? remoteRoomState?.[snakeCase];
    return raw !== undefined && raw !== null;
  };

  return {
    ...localRoom,
    ...remoteRoom,
    roomCode: remoteRoom.roomCode || localRoom.roomCode,
    roomTitle: remoteRoomState?.roomTitle ?? remoteRoomState?.room_title ?? localRoom.roomTitle,
    selectedScaleId: remoteRoomState?.selectedScaleId ?? remoteRoomState?.selected_scale_id ?? localRoom.selectedScaleId,
    revealed: typeof remoteRoomState?.revealed === 'boolean' ? remoteRoom.revealed : localRoom.revealed,
    // An empty remote array/map is meaningful: it may be the result of a reset or leave.
    votes: hasRemoteField('votes', 'votes') ? remoteRoom.votes : localRoom.votes,
    participants: hasRemoteField('participants', 'participants') ? remoteRoom.participants : localRoom.participants,
  };
}

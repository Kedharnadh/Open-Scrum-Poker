export function upsertVoteEntry(votes, entry) {
  const nextVotes = votes.filter((item) => item.id !== entry.id);
  return [...nextVotes, entry];
}

export function removeParticipantVote(votes, participantId) {
  return votes.filter((item) => item.id !== participantId);
}

export function normalizeRoomState(payload) {
  return {
    roomCode: payload?.roomCode || payload?.room_code || '',
    roomTitle: payload?.roomTitle || payload?.room_title || 'Sprint Planning',
    selectedScaleId: payload?.selectedScaleId || payload?.selected_scale_id || '',
    revealed: Boolean(payload?.revealed),
    votes: Array.isArray(payload?.votes) ? payload.votes : [],
    participants: Array.isArray(payload?.participants) ? payload.participants : [],
    activityLog: Array.isArray(payload?.activityLog) ? payload.activityLog : [],
  };
}

export function createRoomState(roomCode, overrides = {}) {
  return normalizeRoomState({
    roomCode,
    roomTitle: overrides.roomTitle || 'Sprint Planning',
    selectedScaleId: overrides.selectedScaleId || '',
    revealed: overrides.revealed ?? false,
    votes: overrides.votes || [],
    participants: overrides.participants || [],
    activityLog: overrides.activityLog || [],
  });
}

export function resolveRoomState(localRoomState, remoteRoomState) {
  const localRoom = normalizeRoomState(localRoomState);
  const remoteRoom = normalizeRoomState(remoteRoomState);

  if (!remoteRoom.roomCode) {
    return localRoom;
  }

  return {
    ...localRoom,
    ...remoteRoom,
    roomCode: remoteRoom.roomCode || localRoom.roomCode,
    roomTitle: remoteRoom.roomTitle || localRoom.roomTitle,
    selectedScaleId: remoteRoom.selectedScaleId || localRoom.selectedScaleId,
    revealed: typeof remoteRoomState?.revealed === 'boolean' ? remoteRoom.revealed : localRoom.revealed,
    votes: remoteRoom.votes.length ? remoteRoom.votes : localRoom.votes,
    participants: remoteRoom.participants.length ? remoteRoom.participants : localRoom.participants,
    activityLog: remoteRoom.activityLog.length ? remoteRoom.activityLog : localRoom.activityLog,
  };
}

export function buildRoomPayload(state) {
  return {
    roomCode: state.roomCode,
    roomTitle: state.roomTitle,
    selectedScaleId: state.selectedScaleId,
    revealed: state.revealed,
    votes: state.votes,
    participants: state.participants,
    activityLog: state.activityLog,
  };
}

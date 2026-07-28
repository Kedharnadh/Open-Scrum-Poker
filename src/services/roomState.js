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

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoomState,
  dedupeVotesByName,
  isRoomExpired,
  normalizeRoomState,
  resolveRoomState,
  upsertVoteEntry,
} from './roomState.js';

test('prefers remote room state when available', () => {
  const result = resolveRoomState(null, {
    roomCode: 'ABC123',
    roomTitle: 'Remote room',
    selectedScaleId: 'fibonacci',
    revealed: true,
    votes: [{ id: 'participant-1', name: 'Alex', vote: '5' }],
    participants: { 'participant-1': { name: 'Alex', online: true, lastSeen: 123 } },
  });

  assert.equal(result?.roomCode, 'ABC123');
  assert.equal(result?.roomTitle, 'Remote room');
  assert.equal(result?.revealed, true);
  assert.deepEqual(result?.participants, { 'participant-1': { id: 'participant-1', name: 'Alex', online: true, lastSeen: 123 } });
});

test('falls back to local room state when no remote state exists', () => {
  const result = resolveRoomState({
    roomCode: 'XYZ789',
    roomTitle: 'Local room',
    selectedScaleId: 'linear-1-8',
    revealed: false,
    votes: [],
    participants: {},
  }, null);

  assert.equal(result?.roomCode, 'XYZ789');
  assert.equal(result?.roomTitle, 'Local room');
  assert.equal(result?.selectedScaleId, 'linear-1-8');
});

test('accepts empty arrays from a remote reset', () => {
  const result = resolveRoomState({
    roomCode: 'XYZ789',
    votes: [{ id: 'participant-1', name: 'Alex', vote: '8' }],
    participants: { 'participant-1': { name: 'Alex', online: true, lastSeen: 1 } },
  }, {
    roomCode: 'XYZ789',
    votes: [],
    participants: {},
  });

  assert.deepEqual(result?.votes, []);
  assert.deepEqual(result?.participants, {});
});

test('creates a provisional room state when no stored room exists', () => {
  const result = createRoomState('ABC999', {
    roomTitle: 'New room',
    selectedScaleId: 'fibonacci',
    hostOnly: true,
    hostId: 'host-1',
  });

  assert.equal(result?.roomCode, 'ABC999');
  assert.equal(result?.roomTitle, 'New room');
  assert.equal(result?.selectedScaleId, 'fibonacci');
  assert.equal(result?.hostOnly, true);
  assert.equal(result?.hostId, 'host-1');
  assert.deepEqual(result?.votes, []);
});

test('normalizes votes stored as a map into an array', () => {
  const result = normalizeRoomState({
    roomCode: 'AB12',
    votes: {
      p1: { name: 'Alex', vote: '5' },
      p2: { name: 'Sam', vote: null },
    },
  });

  assert.deepEqual(result.votes, [
    { id: 'p1', name: 'Alex', vote: '5' },
    { id: 'p2', name: 'Sam', vote: null },
  ]);
});

test('normalizes participants stored as an array into a map', () => {
  const result = normalizeRoomState({
    roomCode: 'AB12',
    participants: [
      { id: 'p1', name: 'Alex', online: true, lastSeen: 123 },
      { id: 'p2', name: 'Sam', online: false, lastSeen: 456 },
    ],
  });

  assert.deepEqual(result.participants, {
    p1: { id: 'p1', name: 'Alex', online: true, lastSeen: 123 },
    p2: { id: 'p2', name: 'Sam', online: false, lastSeen: 456 },
  });
});

test('upserts vote entries from a map', () => {
  const next = upsertVoteEntry({ p1: { name: 'Alex', vote: '3' } }, { id: 'p1', name: 'Alex', vote: '5' });

  assert.deepEqual(next, [{ id: 'p1', name: 'Alex', vote: '5' }]);
});

test('deduplicates votes by name', () => {
  const votes = [
    { id: 'alex-old', name: 'Alex', vote: '3' },
    { id: 'alex-new', name: 'Alex', vote: null },
    { id: 'sam', name: 'Sam', vote: '8' },
  ];

  assert.deepEqual(dedupeVotesByName(votes, 'Alex'), [{ id: 'sam', name: 'Sam', vote: '8' }]);
});

test('reports expired rooms', () => {
  assert.equal(isRoomExpired({ expiresAt: 1000 }, 2000), true);
  assert.equal(isRoomExpired({ expiresAt: 3000 }, 2000), false);
  assert.equal(isRoomExpired({}, 2000), false);
});

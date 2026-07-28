import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomState, resolveRoomState } from './roomState.js';

test('prefers remote room state when available', () => {
  const result = resolveRoomState(null, {
    roomCode: 'ABC123',
    roomTitle: 'Remote room',
    selectedScaleId: 'fibonacci',
    revealed: true,
    votes: [{ id: 'participant-1', name: 'Alex', vote: '5' }],
    participants: [{ id: 'participant-1', name: 'Alex' }],
    activityLog: [{ id: 'join-1', text: 'Alex joined the room' }],
  });

  assert.equal(result?.roomCode, 'ABC123');
  assert.equal(result?.roomTitle, 'Remote room');
  assert.equal(result?.revealed, true);
});

test('falls back to local room state when no remote state exists', () => {
  const result = resolveRoomState({
    roomCode: 'XYZ789',
    roomTitle: 'Local room',
    selectedScaleId: 'linear-1-8',
    revealed: false,
    votes: [],
    participants: [],
    activityLog: [],
  }, null);

  assert.equal(result?.roomCode, 'XYZ789');
  assert.equal(result?.roomTitle, 'Local room');
  assert.equal(result?.selectedScaleId, 'linear-1-8');
});

test('accepts empty arrays from a remote reset', () => {
  const result = resolveRoomState({
    roomCode: 'XYZ789',
    votes: [{ id: 'participant-1', name: 'Alex', vote: '8' }],
    activityLog: [{ id: 'join-1', text: 'Alex joined' }],
  }, {
    roomCode: 'XYZ789',
    votes: [],
    activityLog: [],
  });

  assert.deepEqual(result?.votes, []);
  assert.deepEqual(result?.activityLog, []);
});

test('creates a provisional room state when no stored room exists', () => {
  const result = createRoomState('ABC999', {
    roomTitle: 'New room',
    selectedScaleId: 'fibonacci',
  });

  assert.equal(result?.roomCode, 'ABC999');
  assert.equal(result?.roomTitle, 'New room');
  assert.equal(result?.selectedScaleId, 'fibonacci');
  assert.deepEqual(result?.votes, []);
});

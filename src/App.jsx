import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, onValue, ref, set } from 'firebase/database';
import { database } from './services/firebaseClient';
import { normalizeRoomState, removeParticipantVote, resolveRoomState, upsertVoteEntry } from './services/roomState';

const storageKey = 'scrum-poker-demo-state-v1';
const defaultScales = [
  { id: 'linear-1-8', name: 'Linear 1-8', values: ['1', '2', '3', '4', '5', '6', '7', '8', '?'] },
  { id: 'fibonacci', name: 'Fibonacci', values: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?'] },
  { id: 'tshirt', name: 'T-Shirt', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?'] },
  { id: 'days', name: 'Days', values: ['1', '2', '3', '5', '8', '13', '?'] },
];

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function buildJoinLink(roomCode, roomTitle, selectedScaleId) {
  const params = new URLSearchParams(window.location.search);
  params.set('room', roomCode);
  params.set('title', roomTitle || '');
  params.set('scale', selectedScaleId || '');
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

function App() {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roomTitle, setRoomTitle] = useState('Sprint Planning');
  const [joined, setJoined] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [selectedVote, setSelectedVote] = useState(null);
  const [votes, setVotes] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Ready to connect');
  const [joinLink, setJoinLink] = useState('');
  const [selectedScaleId, setSelectedScaleId] = useState(defaultScales[0].id);
  const [customScales, setCustomScales] = useState([]);
  const [customScaleName, setCustomScaleName] = useState('');
  const [customScaleValuesInput, setCustomScaleValuesInput] = useState('');
  const [activityLog, setActivityLog] = useState([]);
  const [joinError, setJoinError] = useState('');

  const roomCodeRef = useRef(roomCode);
  const revealedRef = useRef(revealed);
  const roomTitleRef = useRef(roomTitle);
  const selectedScaleIdRef = useRef(selectedScaleId);
  const votesRef = useRef(votes);
  const activityLogRef = useRef(activityLog);
  const participantIdRef = useRef('');
  const nameRef = useRef(name);

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);

  useEffect(() => {
    roomTitleRef.current = roomTitle;
  }, [roomTitle]);

  useEffect(() => {
    selectedScaleIdRef.current = selectedScaleId;
  }, [selectedScaleId]);

  useEffect(() => {
    votesRef.current = votes;
  }, [votes]);

  useEffect(() => {
    activityLogRef.current = activityLog;
  }, [activityLog]);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      const params = new URLSearchParams(window.location.search);
      const roomFromUrl = params.get('room');
      const titleFromUrl = params.get('title');
      const scaleFromUrl = params.get('scale');

      if (roomFromUrl) {
        setRoomCode(roomFromUrl.toUpperCase());
      }
      if (titleFromUrl) {
        setRoomTitle(titleFromUrl);
      }
      if (scaleFromUrl) {
        setSelectedScaleId(scaleFromUrl);
      }

      if (!saved) {
        return;
      }

      const parsed = JSON.parse(saved);
      const newRoomLink = roomFromUrl && roomFromUrl.toUpperCase() !== (parsed.roomCode || '').toUpperCase();

      if (newRoomLink) {
        setName(parsed.name || '');
        setRoomCode(roomFromUrl.toUpperCase());
        setRoomTitle(titleFromUrl || 'Sprint Planning');
        setSelectedScaleId(scaleFromUrl || defaultScales[0].id);
        setCustomScales(parsed.customScales || []);
      } else {
        setName(parsed.name || '');
        setRoomCode(parsed.roomCode || roomFromUrl?.toUpperCase() || '');
        setRoomTitle(parsed.roomTitle || titleFromUrl || 'Sprint Planning');
        setJoined(Boolean(parsed.joined));
        setRevealed(Boolean(parsed.revealed));
        setSelectedVote(parsed.selectedVote ?? null);
        setVotes(parsed.votes || []);
        setIsHost(Boolean(parsed.isHost));
        setSelectedScaleId(parsed.selectedScaleId || scaleFromUrl || defaultScales[0].id);
        setCustomScales(parsed.customScales || []);
        setActivityLog(parsed.activityLog || []);
      }

      const savedSession = window.localStorage.getItem(`${storageKey}-session`);
      if (savedSession) {
        try {
          const session = JSON.parse(savedSession);
          if (session.participantId) {
            participantIdRef.current = session.participantId;
          }
        } catch (e) {}
      }

      const refreshFlag = window.sessionStorage.getItem('scrum-poker-refresh');
      if (refreshFlag) {
        window.sessionStorage.removeItem('scrum-poker-refresh');
        const roomCodeValue = newRoomLink ? roomFromUrl?.toUpperCase() || '' : (parsed.roomCode || roomFromUrl?.toUpperCase() || '');
        if (database && participantIdRef.current && roomCodeValue) {
          const normalizedCode = roomCodeValue.toUpperCase();
          get(ref(database, `rooms/${normalizedCode}`)).then((snapshot) => {
            if (snapshot.exists()) {
              const room = normalizeRoomState(snapshot.val());
              const ownVote = (parsed.votes || []).find((item) => item.id === participantIdRef.current)?.vote ?? null;
              const entry = { id: participantIdRef.current, name: parsed.name || '', vote: ownVote };
              const nextVotes = upsertVoteEntry(room.votes || [], entry);
              const nextActivityLog = (room.activityLog || []).filter((logEntry) => logEntry?.participantId !== participantIdRef.current);
              set(ref(database, `rooms/${normalizedCode}`), {
                roomCode: room.roomCode,
                roomTitle: room.roomTitle,
                selectedScaleId: room.selectedScaleId,
                revealed: room.revealed || false,
                votes: nextVotes,
                participants: [],
                activityLog: nextActivityLog,
              });
            }
          });
        }
      } else if (!newRoomLink && parsed.joined) {
        setJoined(false);
      }
    } catch (error) {
      console.error('Unable to restore state', error);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomValue = roomCode || params.get('room') || '';
    if (roomValue) {
      params.set('room', roomValue);
    } else {
      params.delete('room');
    }
    params.set('title', roomTitle || 'Sprint Planning');
    if (selectedScaleId) {
      params.set('scale', selectedScaleId);
    }
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [roomCode, roomTitle, selectedScaleId]);

  useEffect(() => {
    const payload = {
      name,
      roomCode,
      roomTitle,
      joined,
      revealed,
      selectedVote,
      votes,
      isHost,
      selectedScaleId,
      customScales,
      activityLog,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [name, roomCode, roomTitle, joined, revealed, selectedVote, votes, isHost, selectedScaleId, customScales, activityLog]);

  useEffect(() => {
    if (!joined || !roomCode) return;
    const payload = { participantId: participantIdRef.current };
    window.localStorage.setItem(`${storageKey}-session`, JSON.stringify(payload));
  }, [joined, roomCode]);

  useEffect(() => {
    if (!joined || !isHost || !roomCode) return;
    setJoinLink(buildJoinLink(roomCode, roomTitle, selectedScaleId));
  }, [joined, isHost, roomCode, roomTitle, selectedScaleId]);

  const getRoomStorageKey = useCallback((code) => `scrum-poker-room:${(code || '').toUpperCase()}`, []);

  const readStoredRoom = useCallback(async (code) => {
    try {
      const normalizedCode = (code || '').toUpperCase();
      const storedValue = window.localStorage.getItem(getRoomStorageKey(normalizedCode));
      const localRoom = storedValue ? normalizeRoomState(JSON.parse(storedValue)) : null;

      if (!database) {
        return localRoom ? resolveRoomState(localRoom, null) : null;
      }

      const snapshot = await get(ref(database, `rooms/${normalizedCode}`));
      if (!snapshot.exists()) {
        return localRoom ? resolveRoomState(localRoom, null) : null;
      }

      return resolveRoomState(localRoom, snapshot.val());
    } catch (error) {
      console.error('Unable to load room state', error);
      return null;
    }
  }, [getRoomStorageKey]);

  const persistRoom = useCallback(async (nextState) => {
    const normalized = normalizeRoomState({
      roomCode: nextState?.roomCode || roomCodeRef.current,
      roomTitle: nextState?.roomTitle || roomTitleRef.current,
      selectedScaleId: nextState?.selectedScaleId || selectedScaleIdRef.current,
      revealed: nextState?.revealed,
      votes: nextState?.votes || [],
      participants: nextState?.participants || [],
      activityLog: nextState?.activityLog || [],
    });

    const roomCodeValue = (normalized.roomCode || '').toUpperCase();
    if (!roomCodeValue) return;

    const storagePayload = JSON.stringify(normalized);
    window.localStorage.setItem(getRoomStorageKey(roomCodeValue), storagePayload);

    if (database) {
      try {
        await set(ref(database, `rooms/${roomCodeValue}`), normalized);
        setConnectionStatus('Room synced');
        return;
      } catch (error) {
        console.warn('Firebase room sync unavailable, using local storage only', error);
      }
    }

    setConnectionStatus(database ? 'Cloud sync unavailable — changes saved on this device only' : 'Cloud sync is not configured — changes are saved on this device only');
  }, [getRoomStorageKey]);

  const applyRemoteRoomState = useCallback((payload) => {
    const remoteRoom = normalizeRoomState(payload);

    if (!remoteRoom.roomCode || remoteRoom.roomCode.toUpperCase() !== roomCodeRef.current.toUpperCase()) return;

    setRoomTitle(remoteRoom.roomTitle);
    setSelectedScaleId(remoteRoom.selectedScaleId || defaultScales[0].id);
    setRevealed(remoteRoom.revealed);
    setVotes(remoteRoom.votes);
    setActivityLog(remoteRoom.activityLog);
    const ownVote = remoteRoom.votes.find((entry) => entry.id === participantIdRef.current)?.vote ?? null;
    setSelectedVote(ownVote);
    setConnectionStatus('Live connection');
  }, []);

  useEffect(() => {
    if (!joined || !roomCode || !database) return undefined;

    const normalizedCode = roomCode.toUpperCase();
    setConnectionStatus('Connecting to room…');
    return onValue(
      ref(database, `rooms/${normalizedCode}`),
      (snapshot) => {
        if (snapshot.exists()) applyRemoteRoomState(snapshot.val());
        else setConnectionStatus('Waiting for the host to create this room');
      },
      () => setConnectionStatus('Live updates unavailable — refresh to get the latest room state'),
    );
  }, [applyRemoteRoomState, joined, roomCode]);

  useEffect(() => {
    if (!joined || !roomCode || !database) return;

    const cleanup = () => {
      try {
        window.sessionStorage.setItem('scrum-poker-refresh', '1');
      } catch (e) {}

      const nextVotes = removeParticipantVote(votesRef.current, participantIdRef.current);
      const nextActivityLog = [
        { id: `leave-${Date.now()}`, text: `${nameRef.current || 'A participant'} left the room`, participantId: participantIdRef.current },
        ...activityLogRef.current,
      ].slice(0, 8);
      set(ref(database, `rooms/${roomCodeRef.current}`), {
        roomCode: roomCodeRef.current,
        roomTitle: roomTitleRef.current,
        selectedScaleId: selectedScaleIdRef.current,
        revealed: false,
        votes: nextVotes,
        participants: [],
        activityLog: nextActivityLog,
      });
    };

    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('pagehide', cleanup);
    return () => {
      window.removeEventListener('beforeunload', cleanup);
      window.removeEventListener('pagehide', cleanup);
    };
  }, [joined, roomCode, database, name]);

  const createRoom = async () => {
    if (!name.trim()) {
      setJoinError('Please enter your name before creating a room.');
      return;
    }

    const nextRoomCode = (roomCode || generateRoomCode()).toUpperCase();
    const nextRoomTitle = roomTitle || 'Sprint Planning';
    const nextScaleId = selectedScaleId || defaultScales[0].id;
    const nextParticipantId = `${slugify(name)}-${Date.now()}`;
    const nextActivityLog = [{ id: `create-${Date.now()}`, text: `${name} created the room` }];
    const nextVotes = upsertVoteEntry([], { id: nextParticipantId, name, vote: null });

    participantIdRef.current = nextParticipantId;
    setRoomCode(nextRoomCode);
    setJoined(true);
    setIsHost(true);
    setRevealed(false);
    setSelectedVote(null);
    setVotes(nextVotes);
    setActivityLog(nextActivityLog);
    setJoinError('');
    setJoinLink(buildJoinLink(nextRoomCode, nextRoomTitle, nextScaleId));
    setConnectionStatus('Room ready');

    await persistRoom({
      roomCode: nextRoomCode,
      roomTitle: nextRoomTitle,
      selectedScaleId: nextScaleId,
      revealed: false,
      votes: nextVotes,
      participants: [],
      activityLog: nextActivityLog,
    });
  };

  const joinRoom = async () => {
    if (!name.trim()) {
      setJoinError('Please enter your name before joining a room.');
      return;
    }

    const nextRoomCode = (roomCode || '').trim().toUpperCase();
    if (!nextRoomCode) {
      setJoinError('Please enter a room code to join.');
      return;
    }

    const existingRoom = await readStoredRoom(nextRoomCode);
    if (!existingRoom) {
      setJoinError(
        database
          ? 'Room not found. Check the invite link or ask the host to create the room first.'
          : 'Cloud sync is not configured. Add the Firebase settings before joining from another device.',
      );
      return;
    }

    const roomToJoin = existingRoom;

    const nextParticipantId = `${slugify(name)}-${Date.now()}`;
    participantIdRef.current = nextParticipantId;

    const entry = { id: nextParticipantId, name, vote: null };
    const nextVotes = upsertVoteEntry(roomToJoin.votes || [], entry);
    const nextActivityLog = [{ id: `join-${Date.now()}`, text: `${name} joined the room` }, ...(roomToJoin.activityLog || [])].slice(0, 8);

    setRoomCode(nextRoomCode);
    setJoined(true);
    setIsHost(false);
    setRevealed(Boolean(roomToJoin.revealed));
    setRoomTitle(roomToJoin.roomTitle || roomTitle || 'Sprint Planning');
    setSelectedScaleId(roomToJoin.selectedScaleId || selectedScaleId || defaultScales[0].id);
    setVotes(nextVotes);
    setActivityLog(nextActivityLog);
    setJoinError('');
    setConnectionStatus(database ? 'Joined room' : 'Joined local room');

    await persistRoom({
      roomCode: nextRoomCode,
      roomTitle: roomToJoin.roomTitle || roomTitle || 'Sprint Planning',
      selectedScaleId: roomToJoin.selectedScaleId || selectedScaleId || defaultScales[0].id,
      revealed: Boolean(roomToJoin.revealed),
      votes: nextVotes,
      participants: roomToJoin.participants || [],
      activityLog: nextActivityLog,
    });
  };

  const addCustomScale = () => {
    if (!customScaleName.trim() || !customScaleValuesInput.trim()) return;
    const values = customScaleValuesInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) return;

    const nextScale = {
      id: slugify(customScaleName),
      name: customScaleName.trim(),
      values,
    };

    setCustomScales((current) => {
      const nextCustomScales = current.filter((entry) => entry.id !== nextScale.id);
      return [...nextCustomScales, nextScale];
    });
    setSelectedScaleId(nextScale.id);
    setCustomScaleName('');
    setCustomScaleValuesInput('');
  };

  const scaleOptions = useMemo(() => [...defaultScales, ...customScales], [customScales]);
  const activeScale = useMemo(() => {
    const scale = scaleOptions.find((item) => item.id === selectedScaleId);
    return scale || defaultScales[0];
  }, [scaleOptions, selectedScaleId]);

  const submitVote = async (value) => {
    if (!joined) return;
    const normalizedVote = String(value);
    setSelectedVote(normalizedVote);

    const entry = {
      id: participantIdRef.current || `${name}-${Date.now()}`,
      name,
      vote: normalizedVote,
    };

    const nextVotes = upsertVoteEntry(votesRef.current, entry);
    setVotes(nextVotes);
    await persistRoom({
      votes: nextVotes,
      revealed,
      roomTitle: roomTitleRef.current,
      selectedScaleId: selectedScaleIdRef.current,
      activityLog: activityLogRef.current,
    });
  };

  const revealVotes = async () => {
    const nextValue = !revealed;
    setRevealed(nextValue);
    await persistRoom({
      votes: votesRef.current,
      revealed: nextValue,
      roomTitle: roomTitleRef.current,
      selectedScaleId: selectedScaleIdRef.current,
      activityLog: activityLogRef.current,
    });
  };

  const resetRound = async () => {
    setSelectedVote(null);
    setRevealed(false);
    const nextVotes = votesRef.current.map((entry) => ({ ...entry, vote: null }));
    setVotes(nextVotes);
    await persistRoom({
      votes: nextVotes,
      revealed: false,
      roomTitle: roomTitleRef.current,
      selectedScaleId: selectedScaleIdRef.current,
      activityLog: activityLogRef.current,
    });
  };

  const leaveRoom = async () => {
    const nextVotes = removeParticipantVote(votesRef.current, participantIdRef.current);
    const nextActivityLog = [{ id: `leave-${Date.now()}`, text: `${name || 'You'} left the room` }, ...activityLogRef.current].slice(0, 8);
    setVotes(nextVotes);
    setActivityLog(nextActivityLog);
    await persistRoom({
      votes: nextVotes,
      revealed: false,
      roomTitle: roomTitleRef.current,
      selectedScaleId: selectedScaleIdRef.current,
      activityLog: nextActivityLog,
    });
    setJoined(false);
    setVotes([]);
    setSelectedVote(null);
    setRevealed(false);
    setRoomCode('');
    setIsHost(false);
    setJoinLink('');
    setConnectionStatus('Ready to connect');
    window.history.replaceState({}, '', window.location.pathname);
  };

  const copyInviteLink = async () => {
    if (!joinLink) return;
    try {
      await navigator.clipboard.writeText(joinLink);
      setConnectionStatus('Invite link copied');
    } catch (error) {
      console.error('Unable to copy link', error);
    }
  };

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Scrum Poker</p>
          <h1>{roomTitle || 'Scrum Poker Room'}</h1>
        </div>
        <div className="pill">{joined ? `Room ${roomCode}` : 'Not joined'}</div>
      </header>

      {!joined ? (
        <section className="card form-card">
          <h2>Create or join a room</h2>
          <label>
            Your name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex" />
          </label>
          <label>
            Room title
            <input value={roomTitle} onChange={(event) => setRoomTitle(event.target.value)} placeholder="Sprint Planning" />
          </label>
          <label>
            Room code
            <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="AB12" />
          </label>
          <label>
            Estimation scale
            <select value={selectedScaleId} onChange={(event) => setSelectedScaleId(event.target.value)}>
              {scaleOptions.map((scale) => (
                <option key={scale.id} value={scale.id}>
                  {scale.name}
                </option>
              ))}
            </select>
          </label>
          <div className="scale-builder">
            <input
              value={customScaleName}
              onChange={(event) => setCustomScaleName(event.target.value)}
              placeholder="New scale name"
            />
            <input
              value={customScaleValuesInput}
              onChange={(event) => setCustomScaleValuesInput(event.target.value)}
              placeholder="Values, separated, by commas"
            />
            <button className="secondary" onClick={addCustomScale}>Create custom scale</button>
          </div>
          <div className="button-row">
            {!new URLSearchParams(window.location.search).has('room') ? <button onClick={createRoom}>Create room</button> : null}
            <button className="secondary" onClick={joinRoom}>Join room</button>
          </div>
          {joinError ? <p className="muted status-line">{joinError}</p> : null}
          <p className="muted status-line">Share the room link from the host and enter your name before you join.</p>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Live session</p>
                <h2>{roomTitle}</h2>
              </div>
              <div className="button-row compact">
                <button onClick={revealVotes}>{revealed ? 'Hide votes' : 'Reveal votes'}</button>
                <button className="secondary" onClick={resetRound}>Reset round</button>
                <button className="ghost" onClick={leaveRoom}>Leave</button>
              </div>
            </div>
            <p className="muted">Welcome, {name}. {isHost ? 'You are hosting this room.' : 'You are joining as a participant.'}</p>
            <p className="status-line">Connection: {connectionStatus}</p>
            {isHost && joinLink ? (
              <div className="share-box">
                <span>{joinLink}</span>
                <button className="secondary" onClick={copyInviteLink}>Copy invite link</button>
              </div>
            ) : null}
          </section>

          <div className="room-body">
            <section className="card">
              <h3>Choose your estimate</h3>
              <div className="card-grid">
                {activeScale.values.map((value) => (
                  <button
                    key={value}
                    className={`vote-card ${selectedVote === value ? 'selected' : ''}`}
                    onClick={() => submitVote(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </section>

            <section className="card participants-column">
              <h3>Participants</h3>
              <ul className="participant-list">
                {votes.length === 0 ? (
                  <li className="muted">No one has voted yet.</li>
                ) : (
                  votes.map((entry) => (
                    <li key={`${entry.id}-${entry.name}`}>
                      <span>{entry.name}</span>
                      <strong>{revealed ? entry.vote ?? '—' : entry.vote ? '✓' : 'Pending'}</strong>
                    </li>
                  ))
                )}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default App;

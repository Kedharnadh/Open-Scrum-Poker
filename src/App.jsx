import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, onDisconnect, onValue, ref, remove, set, update } from 'firebase/database';
import { database, ensureAuth } from './services/firebaseClient';
import {
  dedupeVotesByName,
  isRoomExpired,
  normalizeRoomState,
  resolveRoomState,
  upsertVoteEntry,
} from './services/roomState';

const nameKey = 'scrum-poker-demo-name';
const draftKey = 'scrum-poker-demo-draft';
const lastRoomKey = 'scrum-poker-demo-last-room';
const participantIdKey = 'scrum-poker-demo-participant-id';
const customScalesKey = 'scrum-poker-demo-custom-scales';
const scalePrefKey = 'scrum-poker-scale-preference';
const refreshFlagKey = 'scrum-poker-refresh';
const ROOM_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const STALE_PRESENCE_MS = 90 * 1000;
const HEARTBEAT_MS = 30 * 1000;

const defaultScales = [
  { id: 'linear-1-8', name: 'Linear 1-8', values: ['1', '2', '3', '4', '5', '6', '7', '8', '?'] },
  { id: 'fibonacci', name: 'Fibonacci', values: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?'] },
  { id: 'tshirt', name: 'T-Shirt', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?'] },
  { id: 'days', name: 'Days', values: ['1', '2', '3', '5', '8', '13', '?'] },
];

const CUSTOM_SCALE_ID = '__custom__';

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

function getOrCreateParticipantId(name) {
  try {
    const existing = window.localStorage.getItem(participantIdKey);
    if (existing) {
      return existing;
    }
    const nextId = `${slugify(name)}-${Date.now()}`;
    window.localStorage.setItem(participantIdKey, nextId);
    return nextId;
  } catch (error) {
    return `${slugify(name)}-${Date.now()}`;
  }
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
  const [hostOnly, setHostOnly] = useState(false);
  const [selectedVote, setSelectedVote] = useState(null);
  const [votes, setVotes] = useState([]);
  const [participants, setParticipants] = useState({});
  const [isHost, setIsHost] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Ready to connect');
  const [canRetry, setCanRetry] = useState(false);
  const [joinLink, setJoinLink] = useState('');
  const [selectedScaleId, setSelectedScaleId] = useState(() => {
    try {
      return window.localStorage.getItem(scalePrefKey) || defaultScales[0].id;
    } catch (error) {
      return defaultScales[0].id;
    }
  });
  const [customScales, setCustomScales] = useState([]);
  const [customScaleName, setCustomScaleName] = useState('');
  const [customScaleValuesInput, setCustomScaleValuesInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [listenerEpoch, setListenerEpoch] = useState(0);
  const [expired, setExpired] = useState(false);
  const [authReady, setAuthReady] = useState(!database);

  const roomCodeRef = useRef(roomCode);
  const roomTitleRef = useRef(roomTitle);
  const selectedScaleIdRef = useRef(selectedScaleId);
  const revealedRef = useRef(revealed);
  const hostOnlyRef = useRef(hostOnly);
  const votesRef = useRef(votes);
  const participantsRef = useRef(participants);
  const isHostRef = useRef(isHost);
  const selectedVoteRef = useRef(selectedVote);
  const joinedRef = useRef(joined);
  const nameRef = useRef(name);
  const participantIdRef = useRef('');
  const participantDisconnectRef = useRef(null);
  const voteDisconnectRef = useRef(null);
  const hasMountedRef = useRef(false);

  const persistScalePreference = (nextScaleId) => {
    try {
      window.localStorage.setItem(scalePrefKey, nextScaleId);
    } catch (error) {}
  };

  const hasRoomParam = new URLSearchParams(window.location.search).has('room');

  useEffect(() => {
    roomCodeRef.current = roomCode;
    roomTitleRef.current = roomTitle;
    selectedScaleIdRef.current = selectedScaleId;
    revealedRef.current = revealed;
    hostOnlyRef.current = hostOnly;
    votesRef.current = votes;
    participantsRef.current = participants;
    isHostRef.current = isHost;
    selectedVoteRef.current = selectedVote;
    joinedRef.current = joined;
    nameRef.current = name;
  });

  const getRoomStorageKey = useCallback((code) => `scrum-poker-demo-room:${(code || '').toUpperCase()}`, []);

  const cacheRoomState = useCallback((code, payload) => {
    const roomCodeValue = code || roomCodeRef.current;
    if (!roomCodeValue) return;
    const data = payload || {
      name: nameRef.current,
      roomCode: roomCodeValue,
      roomTitle: roomTitleRef.current,
      joined: joinedRef.current,
      revealed: revealedRef.current,
      hostOnly: hostOnlyRef.current,
      selectedVote: selectedVoteRef.current,
      votes: votesRef.current,
      participants: participantsRef.current,
      isHost: isHostRef.current,
      selectedScaleId: selectedScaleIdRef.current,
    };
    try {
      window.localStorage.setItem(getRoomStorageKey(roomCodeValue), JSON.stringify(data));
      window.localStorage.setItem(lastRoomKey, roomCodeValue);
    } catch (error) {}
  }, [getRoomStorageKey]);

  const currentRoomSnapshot = useCallback(() => ({
    name: nameRef.current,
    roomCode: roomCodeRef.current,
    roomTitle: roomTitleRef.current,
    joined: joinedRef.current,
    revealed: revealedRef.current,
    hostOnly: hostOnlyRef.current,
    selectedVote: selectedVoteRef.current,
    votes: votesRef.current,
    participants: participantsRef.current,
    isHost: isHostRef.current,
    selectedScaleId: selectedScaleIdRef.current,
  }), []);

  const registerPresence = useCallback(async (code, id, participantName) => {
    if (!database || !code || !id) return;
    const codeValue = code.toUpperCase();
    const now = Date.now();
    const cachedVote = votesRef.current.find((entry) => entry.id === id)?.vote ?? null;
    const updates = {
      [`participants/${id}`]: { name: participantName, online: true, lastSeen: now },
      [`votes/${id}`]: { name: participantName, vote: cachedVote },
      updatedAt: now,
      expiresAt: now + ROOM_TTL_MS,
    };

    if (participantDisconnectRef.current) {
      participantDisconnectRef.current.cancel().catch(() => {});
      participantDisconnectRef.current = null;
    }
    if (voteDisconnectRef.current) {
      voteDisconnectRef.current.cancel().catch(() => {});
      voteDisconnectRef.current = null;
    }

    try {
      await update(ref(database, `rooms/${codeValue}`), updates);
      const participantDisconnect = onDisconnect(ref(database, `rooms/${codeValue}/participants/${id}`));
      const voteDisconnect = onDisconnect(ref(database, `rooms/${codeValue}/votes/${id}`));
      participantDisconnect.remove();
      voteDisconnect.remove();
      participantDisconnectRef.current = participantDisconnect;
      voteDisconnectRef.current = voteDisconnect;
    } catch (error) {
      console.warn('Unable to register presence', error);
    }
  }, []);

  const restorePresence = useCallback(async (code, id) => {
    if (!database || !code || !id) return;
    const codeValue = code.toUpperCase();
    try {
      const snapshot = await get(ref(database, `rooms/${codeValue}`));
      if (!snapshot.exists()) return;
      const room = normalizeRoomState(snapshot.val());
      if (room.participants[id]) return;
      const nameToUse = nameRef.current
        || room.votes.find((entry) => entry.id === id)?.name
        || 'Participant';
      await registerPresence(codeValue, id, nameToUse);
    } catch (error) {
      console.warn('Unable to restore presence', error);
    }
  }, [registerPresence]);

  const readStoredRoom = useCallback(async (code) => {
    try {
      const normalizedCode = (code || '').toUpperCase();
      const storedValue = window.localStorage.getItem(getRoomStorageKey(normalizedCode));
      const localRoom = storedValue ? normalizeRoomState(JSON.parse(storedValue)) : null;

      if (!database) {
        return localRoom || null;
      }

      const snapshot = await get(ref(database, `rooms/${normalizedCode}`));
      if (!snapshot.exists()) {
        return localRoom || null;
      }
      const remote = normalizeRoomState(snapshot.val());
      if (isRoomExpired(remote)) {
        remove(ref(database, `rooms/${normalizedCode}`)).catch(() => {});
        return null;
      }
      return resolveRoomState(localRoom, remote);
    } catch (error) {
      console.error('Unable to load room state', error);
      return null;
    }
  }, [getRoomStorageKey]);

  const applyRemoteRoomState = useCallback((payload) => {
    const remoteRoom = normalizeRoomState(payload);
    if (!remoteRoom.roomCode || remoteRoom.roomCode.toUpperCase() !== roomCodeRef.current.toUpperCase()) return;

    if (isRoomExpired(remoteRoom)) {
      setExpired(true);
      setCanRetry(false);
      remove(ref(database, `rooms/${roomCodeRef.current.toUpperCase()}`)).catch(() => {});
      return;
    }

    setRoomTitle(remoteRoom.roomTitle);
    setSelectedScaleId(remoteRoom.selectedScaleId || defaultScales[0].id);
    setRevealed(remoteRoom.revealed);
    setHostOnly(remoteRoom.hostOnly);
    setVotes(remoteRoom.votes);
    setParticipants(remoteRoom.participants);
    const ownVote = remoteRoom.votes.find((entry) => entry.id === participantIdRef.current)?.vote ?? null;
    setSelectedVote(ownVote);
    setCanRetry(false);
    setConnectionStatus('Live connection');

    const now = Date.now();
    const staleIds = Object.keys(remoteRoom.participants).filter((id) => {
      const lastSeen = remoteRoom.participants[id]?.lastSeen;
      return lastSeen && now - lastSeen > STALE_PRESENCE_MS;
    });
    if (staleIds.length > 0) {
      const cleanupUpdates = {};
      staleIds.forEach((id) => {
        cleanupUpdates[`participants/${id}`] = null;
        cleanupUpdates[`votes/${id}`] = null;
      });
      update(ref(database, `rooms/${roomCodeRef.current.toUpperCase()}`), cleanupUpdates).catch(() => {});
    }

    const ownId = participantIdRef.current;
    const participantPresent = ownId && Boolean(remoteRoom.participants[ownId]);
    const votePresent = ownId && remoteRoom.votes.some((entry) => entry.id === ownId);
    const cachedOwnVote = votesRef.current.find((entry) => entry.id === ownId)?.vote;
    if (joinedRef.current && ownId && (!participantPresent || (!votePresent && cachedOwnVote))) {
      registerPresence(roomCodeRef.current, ownId, nameRef.current);
    }
  }, [registerPresence]);

  useEffect(() => {
    try {
      window.localStorage.setItem(nameKey, name);
    } catch (error) {}
  }, [name]);

  useEffect(() => {
    try {
      window.localStorage.setItem(customScalesKey, JSON.stringify(customScales));
    } catch (error) {}
  }, [customScales]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (joined || hasRoomParam) return;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ roomTitle, roomCode }));
    } catch (error) {}
  }, [joined, roomCode, roomTitle, hasRoomParam]);

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
    if (!joined || !isHost || !roomCode) return;
    setJoinLink(buildJoinLink(roomCode, roomTitle, selectedScaleId));
  }, [joined, isHost, roomCode, roomTitle, selectedScaleId]);

  useEffect(() => {
    if (!database) return undefined;
    let mounted = true;
    ensureAuth().finally(() => {
      if (mounted) setAuthReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setCanRetry(false);
      setConnectionStatus('Back online — reconnecting…');
      setListenerEpoch((value) => value + 1);
    };
    const handleVisibility = () => {
      if (!document.hidden) {
        setListenerEpoch((value) => value + 1);
      }
    };
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!joined || !roomCode || !database || !authReady) return undefined;

    const codeValue = roomCode.toUpperCase();
    setConnectionStatus('Connecting to room…');
    return onValue(
      ref(database, `rooms/${codeValue}`),
      (snapshot) => {
        if (snapshot.exists()) {
          applyRemoteRoomState(snapshot.val());
        } else {
          setConnectionStatus('Waiting for the host to create this room');
        }
      },
      (error) => {
        console.warn('Live updates unavailable', error);
        setCanRetry(true);
        setConnectionStatus('Live updates unavailable — check your connection and retry');
      },
    );
  }, [applyRemoteRoomState, authReady, joined, listenerEpoch, roomCode]);

  useEffect(() => {
    if (!joined || !roomCode || !database || !authReady) return undefined;

    const codeValue = roomCode.toUpperCase();
    const ownId = participantIdRef.current;
    const beat = () => {
      if (!ownId) return;
      const now = Date.now();
      update(ref(database, `rooms/${codeValue}`), {
        [`participants/${ownId}/lastSeen`]: now,
        updatedAt: now,
        expiresAt: now + ROOM_TTL_MS,
      }).catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [authReady, joined, roomCode]);

  useEffect(() => {
    if (!joined || !roomCode || !database) return undefined;

    const codeValue = roomCodeRef.current.toUpperCase();
    const cleanup = () => {
      try {
        window.sessionStorage.setItem(refreshFlagKey, '1');
      } catch (error) {}
      const ownId = participantIdRef.current;
      if (!ownId) return;
      remove(ref(database, `rooms/${codeValue}/votes/${ownId}`)).catch(() => {});
      remove(ref(database, `rooms/${codeValue}/participants/${ownId}`)).catch(() => {});
    };

    window.addEventListener('pagehide', cleanup);
    return () => window.removeEventListener('pagehide', cleanup);
  }, [joined, roomCode, database]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = (params.get('room') || '').toUpperCase();
    const titleFromUrl = params.get('title');
    const scaleFromUrl = params.get('scale');

    if (roomFromUrl) {
      setRoomCode(roomFromUrl);
    }
    if (titleFromUrl) {
      setRoomTitle(titleFromUrl);
    }
    if (scaleFromUrl) {
      setSelectedScaleId(scaleFromUrl);
    }

    const refreshFlag = window.sessionStorage.getItem(refreshFlagKey);
    if (refreshFlag) {
      window.sessionStorage.removeItem(refreshFlagKey);
    }

    let savedName = '';
    try {
      savedName = window.localStorage.getItem(nameKey) || '';
      if (savedName) setName(savedName);
      const savedParticipantId = window.localStorage.getItem(participantIdKey);
      if (savedParticipantId) participantIdRef.current = savedParticipantId;
      const savedScales = window.localStorage.getItem(customScalesKey);
      if (savedScales) setCustomScales(JSON.parse(savedScales));
    } catch (error) {
      console.warn('Unable to restore preferences', error);
    }

    if (roomFromUrl) {
      let parsed = null;
      try {
        const savedRoom = window.localStorage.getItem(getRoomStorageKey(roomFromUrl));
        if (savedRoom) parsed = JSON.parse(savedRoom);
      } catch (error) {
        console.warn('Unable to restore room state', error);
      }

      if (parsed) {
        const roomFields = normalizeRoomState(parsed);
        setName(parsed.name || savedName);
        setRoomTitle(roomFields.roomTitle || titleFromUrl || 'Sprint Planning');
        setSelectedScaleId(roomFields.selectedScaleId || scaleFromUrl || defaultScales[0].id);
        setRevealed(roomFields.revealed);
        setHostOnly(roomFields.hostOnly);
        setSelectedVote(parsed.selectedVote ?? null);
        setVotes(roomFields.votes);
        setParticipants(roomFields.participants);
        setIsHost(Boolean(parsed.isHost));

        if (parsed.joined) {
          setJoined(true);
          joinedRef.current = true;
          if (refreshFlag && database && participantIdRef.current && !cancelled) {
            restorePresence(roomFromUrl, participantIdRef.current);
          }
        }
      }
    } else {
      try {
        const savedDraft = window.localStorage.getItem(draftKey);
        if (savedDraft) {
          const draft = JSON.parse(savedDraft);
          if (draft.roomTitle) setRoomTitle(draft.roomTitle);
          if (draft.roomCode) setRoomCode(draft.roomCode);
        }
      } catch (error) {
        console.warn('Unable to restore draft', error);
      }
    }
  }, [getRoomStorageKey, restorePresence]);

  const findAvailableRoomCode = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = generateRoomCode();
      if (!database) {
        return candidate;
      }
      const snapshot = await get(ref(database, `rooms/${candidate}`));
      if (!snapshot.exists()) {
        return candidate;
      }
    }
    return `${generateRoomCode()}${Date.now().toString(36).slice(-2).toUpperCase()}`;
  };

  const roomExists = async (code) => {
    if (!database) return false;
    try {
      const snapshot = await get(ref(database, `rooms/${(code || '').toUpperCase()}`));
      return snapshot.exists();
    } catch (error) {
      return false;
    }
  };

  const createRoom = async () => {
    if (!name.trim()) {
      setJoinError('Please enter your name before creating a room.');
      return;
    }

    await ensureAuth();
    const nextParticipantId = getOrCreateParticipantId(name);
    participantIdRef.current = nextParticipantId;
    const nextRoomTitle = roomTitle || 'Sprint Planning';
    const nextScaleId = selectedScaleId === CUSTOM_SCALE_ID || !selectedScaleId
      ? defaultScales[0].id
      : selectedScaleId;
    persistScalePreference(nextScaleId);

    let nextRoomCode = (roomCode || '').trim().toUpperCase();
    if (!nextRoomCode) {
      nextRoomCode = await findAvailableRoomCode();
    } else if (await roomExists(nextRoomCode)) {
      setJoinError('That room code is already in use. Leave the code empty to auto-generate one.');
      return;
    }

    const now = Date.now();
    const initialVote = { id: nextParticipantId, name, vote: null };
    const initialParticipants = {
      [nextParticipantId]: { id: nextParticipantId, name, online: true, lastSeen: now },
    };
    const baseRoom = {
      roomCode: nextRoomCode,
      roomTitle: nextRoomTitle,
      selectedScaleId: nextScaleId,
      revealed: false,
      hostOnly,
      hostId: nextParticipantId,
      updatedAt: now,
      expiresAt: now + ROOM_TTL_MS,
      votes: {
        [nextParticipantId]: { name, vote: null },
      },
      participants: {
        [nextParticipantId]: { name, online: true, lastSeen: now },
      },
    };

    setRoomCode(nextRoomCode);
    setJoined(true);
    joinedRef.current = true;
    setIsHost(true);
    setRevealed(false);
    setHostOnly(hostOnly);
    setSelectedVote(null);
    setVotes([initialVote]);
    setParticipants(initialParticipants);
    setJoinError('');
    setExpired(false);
    setJoinLink(buildJoinLink(nextRoomCode, nextRoomTitle, nextScaleId));
    setConnectionStatus(database ? 'Creating room…' : 'Room ready');

    cacheRoomState(nextRoomCode, {
      name,
      roomCode: nextRoomCode,
      roomTitle: nextRoomTitle,
      joined: true,
      revealed: false,
      hostOnly,
      selectedVote: null,
      votes: [initialVote],
      participants: initialParticipants,
      isHost: true,
      selectedScaleId: nextScaleId,
    });

    if (!database) return;

    try {
      await set(ref(database, `rooms/${nextRoomCode}`), baseRoom);
      await registerPresence(nextRoomCode, nextParticipantId, name);
      setConnectionStatus('Room ready');
    } catch (error) {
      console.warn('Unable to create the room on Firebase', error);
      setConnectionStatus('Cloud sync unavailable — changes saved on this device only');
    }
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

    await ensureAuth();
    const existingRoom = await readStoredRoom(nextRoomCode);
    if (!existingRoom) {
      setJoinError(
        database
          ? 'Room not found. Check the invite link or ask the host to create the room first.'
          : 'Cloud sync is not configured. Add the Firebase settings before joining from another device.',
      );
      return;
    }

    const nextParticipantId = getOrCreateParticipantId(name);
    participantIdRef.current = nextParticipantId;

    const entry = { id: nextParticipantId, name, vote: null };
    const nextVotes = upsertVoteEntry(dedupeVotesByName(existingRoom.votes || [], name), entry);
    const roomScaleId = existingRoom.selectedScaleId
      || (selectedScaleId === CUSTOM_SCALE_ID ? defaultScales[0].id : selectedScaleId)
      || defaultScales[0].id;
    persistScalePreference(roomScaleId);

    setRoomCode(nextRoomCode);
    setJoined(true);
    joinedRef.current = true;
    setIsHost(existingRoom.hostId === nextParticipantId);
    setRevealed(Boolean(existingRoom.revealed));
    setHostOnly(Boolean(existingRoom.hostOnly));
    setRoomTitle(existingRoom.roomTitle || roomTitle || 'Sprint Planning');
    setSelectedScaleId(roomScaleId);
    setSelectedVote(null);
    setVotes(nextVotes);
    setParticipants(existingRoom.participants || {});
    setJoinError('');
    setExpired(false);
    setConnectionStatus(database ? 'Joining room…' : 'Joined room');

    cacheRoomState(nextRoomCode, {
      name,
      roomCode: nextRoomCode,
      roomTitle: existingRoom.roomTitle || roomTitle || 'Sprint Planning',
      joined: true,
      revealed: Boolean(existingRoom.revealed),
      hostOnly: Boolean(existingRoom.hostOnly),
      selectedVote: null,
      votes: nextVotes,
      participants: existingRoom.participants || {},
      isHost: existingRoom.hostId === nextParticipantId,
      selectedScaleId: roomScaleId,
    });

    if (database) {
      await registerPresence(nextRoomCode, nextParticipantId, name);
      setConnectionStatus('Joined room');
    }
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
    persistScalePreference(nextScale.id);
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
    if (!activeScale.values.includes(normalizedVote)) return;

    const ownId = participantIdRef.current || getOrCreateParticipantId(name);
    participantIdRef.current = ownId;
    const entry = { id: ownId, name, vote: normalizedVote };
    const nextVotes = upsertVoteEntry(votesRef.current, entry);

    setSelectedVote(normalizedVote);
    setVotes(nextVotes);
    const codeValue = roomCodeRef.current.toUpperCase();
    cacheRoomState(codeValue, {
      ...currentRoomSnapshot(),
      selectedVote: normalizedVote,
      votes: nextVotes,
    });

    if (!database) return;

    const now = Date.now();
    try {
      await update(ref(database, `rooms/${codeValue}`), {
        [`votes/${ownId}`]: { name, vote: normalizedVote },
        updatedAt: now,
        expiresAt: now + ROOM_TTL_MS,
      });
      setConnectionStatus('Vote synced');
    } catch (error) {
      console.warn('Unable to sync vote', error);
      setConnectionStatus('Vote saved on this device only — cloud sync unavailable');
    }
  };

  const revealVotes = async () => {
    if (!joined) return;
    if (hostOnly && !isHost) return;

    const nextValue = !revealed;
    setRevealed(nextValue);
    const codeValue = roomCodeRef.current.toUpperCase();
    cacheRoomState(codeValue, { ...currentRoomSnapshot(), revealed: nextValue });

    if (!database) return;

    const now = Date.now();
    try {
      await update(ref(database, `rooms/${codeValue}`), {
        revealed: nextValue,
        updatedAt: now,
        expiresAt: now + ROOM_TTL_MS,
      });
      setConnectionStatus(nextValue ? 'Votes revealed' : 'Votes hidden');
    } catch (error) {
      console.warn('Unable to sync reveal state', error);
      setConnectionStatus('Cloud sync unavailable — change saved on this device only');
    }
  };

  const resetRound = async () => {
    if (!joined) return;
    if (hostOnly && !isHost) return;

    setSelectedVote(null);
    setRevealed(false);
    const nextVotes = votesRef.current.map((entry) => ({ ...entry, vote: null }));
    setVotes(nextVotes);
    const codeValue = roomCodeRef.current.toUpperCase();
    cacheRoomState(codeValue, {
      ...currentRoomSnapshot(),
      selectedVote: null,
      revealed: false,
      votes: nextVotes,
    });

    if (!database) return;

    const now = Date.now();
    const updates = {
      revealed: false,
      updatedAt: now,
      expiresAt: now + ROOM_TTL_MS,
    };
    for (const entry of votesRef.current) {
      updates[`votes/${entry.id}`] = { name: entry.name, vote: null };
    }
    try {
      await update(ref(database, `rooms/${codeValue}`), updates);
      setConnectionStatus('Round reset');
    } catch (error) {
      console.warn('Unable to reset the round', error);
      setConnectionStatus('Cloud sync unavailable — change saved on this device only');
    }
  };

  const leaveRoom = async () => {
    const codeValue = roomCodeRef.current.toUpperCase();
    const ownId = participantIdRef.current;

    setJoined(false);
    joinedRef.current = false;
    setVotes([]);
    setParticipants({});
    setSelectedVote(null);
    setRevealed(false);
    setHostOnly(false);
    setRoomCode('');
    setIsHost(false);
    setJoinLink('');
    setConnectionStatus('Ready to connect');
    window.history.replaceState({}, '', window.location.pathname);

    window.localStorage.removeItem(getRoomStorageKey(codeValue));
    window.localStorage.removeItem(lastRoomKey);

    if (!database || !ownId) return;

    if (participantDisconnectRef.current) {
      participantDisconnectRef.current.cancel().catch(() => {});
      participantDisconnectRef.current = null;
    }
    if (voteDisconnectRef.current) {
      voteDisconnectRef.current.cancel().catch(() => {});
      voteDisconnectRef.current = null;
    }
    remove(ref(database, `rooms/${codeValue}/votes/${ownId}`)).catch(() => {});
    remove(ref(database, `rooms/${codeValue}/participants/${ownId}`)).catch(() => {});
  };

  const retryConnection = () => {
    setCanRetry(false);
    setConnectionStatus('Reconnecting…');
    if (joined && roomCode && database) {
      registerPresence(roomCode, participantIdRef.current, nameRef.current);
    }
    setListenerEpoch((value) => value + 1);
  };

  const resetExpired = () => {
    setExpired(false);
    setJoined(false);
    joinedRef.current = false;
    setVotes([]);
    setParticipants({});
    setSelectedVote(null);
    setRevealed(false);
    setHostOnly(false);
    setRoomCode('');
    setIsHost(false);
    setJoinLink('');
    setConnectionStatus('Ready to connect');
    window.history.replaceState({}, '', window.location.pathname);
    window.localStorage.removeItem(getRoomStorageKey(roomCodeRef.current));
    window.localStorage.removeItem(lastRoomKey);
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

  const participantEntries = useMemo(() => {
    const entries = [];
    const participantIds = Object.keys(participants);
    if (participantIds.length === 0) {
      for (const voteEntry of votes) {
        entries.push({ id: voteEntry.id, name: voteEntry.name, online: true, vote: voteEntry.vote });
      }
      return entries;
    }
    for (const [id, participant] of Object.entries(participants)) {
      const voteEntry = votes.find((entry) => entry.id === id);
      entries.push({
        id,
        name: participant.name || voteEntry?.name || '',
        online: Boolean(participant.online),
        vote: voteEntry?.vote ?? null,
      });
    }
    return entries;
  }, [participants, votes]);

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Scrum Poker</p>
          <h1>{roomTitle || 'Scrum Poker Room'}</h1>
        </div>
        <div className="pill">{joined ? `Room ${roomCode}` : 'Not joined'}</div>
      </header>

      {expired ? (
        <section className="card">
          <h2>This room has expired</h2>
          <p className="muted">Rooms expire after a period of inactivity. Create a new room to keep planning.</p>
          <div className="button-row">
            <button onClick={resetExpired}>Create a new room</button>
          </div>
        </section>
      ) : !joined ? (
        <section className="card form-card">
          <h2>Create or join a room</h2>
          <label>
            Your name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex" autoComplete="name" />
          </label>
          {!hasRoomParam ? (
            <label>
              Room title
              <input value={roomTitle} onChange={(event) => setRoomTitle(event.target.value)} placeholder="Sprint Planning" />
            </label>
          ) : null}
          <label>
            Room code
            <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="AB12" autoComplete="off" />
          </label>
          {!hasRoomParam ? (
            <>
              <label>
                Estimation scale
                <select value={selectedScaleId} onChange={(event) => { setSelectedScaleId(event.target.value); persistScalePreference(event.target.value); }}>
                  {scaleOptions.map((scale) => (
                    <option key={scale.id} value={scale.id}>
                      {scale.name}
                    </option>
                  ))}
                  <option value={CUSTOM_SCALE_ID}>Custom scale</option>
                </select>
              </label>
              {selectedScaleId === CUSTOM_SCALE_ID ? (
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
              ) : null}
            </>
          ) : null}
          {!hasRoomParam ? (
            <label className="check-row">
              <input type="checkbox" checked={hostOnly} onChange={(event) => setHostOnly(event.target.checked)} />
              Restrict Reveal / Reset to the host
            </label>
          ) : null}
          <div className="button-row">
            {!hasRoomParam ? <button onClick={createRoom}>Create room</button> : null}
            <button className="secondary" onClick={joinRoom}>Join room</button>
          </div>
          {joinError ? <p className="muted status-line" role="alert">{joinError}</p> : null}
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
                {(!hostOnly || isHost) ? (
                  <>
                    <button aria-pressed={revealed} onClick={revealVotes}>{revealed ? 'Hide votes' : 'Reveal votes'}</button>
                    <button className="secondary" onClick={resetRound}>Reset round</button>
                  </>
                ) : null}
                <button className="ghost" onClick={leaveRoom}>Leave</button>
              </div>
            </div>
            <p className="muted">
              Welcome, {name}. {isHost ? 'You are hosting this room.' : 'You are joining as a participant.'}
              {hostOnly && !isHost ? ' Only the host can reveal or reset the round.' : ''}
            </p>
            <div className="status-row">
              <p className="status-line" role="status" aria-live="polite">Connection: {connectionStatus}</p>
              {canRetry ? <button className="ghost" onClick={retryConnection}>Retry connection</button> : null}
            </div>
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
                    aria-pressed={selectedVote === value}
                    aria-label={`Vote ${value}`}
                    onClick={() => submitVote(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </section>

            <section className="card participants-column">
              <h3>Participants</h3>
              <ul className="participant-list" aria-live="polite" aria-relevant="additions removals">
                {participantEntries.length === 0 ? (
                  <li className="muted">No participants yet.</li>
                ) : (
                  participantEntries.map((entry) => {
                    const hasVoted = Boolean(entry.vote);
                    const validVote = entry.vote && activeScale.values.includes(String(entry.vote)) ? String(entry.vote) : null;
                    const statusLabel = revealed
                      ? validVote
                        ? `voted ${validVote}`
                        : 'did not vote'
                      : hasVoted
                        ? 'has voted'
                        : 'has not voted';
                    const voteText = revealed
                      ? validVote || '—'
                      : hasVoted
                        ? '✓'
                        : 'Pending';
                    return (
                      <li key={entry.id}>
                        <span>
                          {entry.name}
                          <span className="sr-only">{statusLabel}</span>
                        </span>
                        <strong aria-hidden="true">{voteText}</strong>
                      </li>
                    );
                  })
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

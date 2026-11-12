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
// Hidden for now while the round-summary design is revisited.
const SHOW_ROUND_SUMMARY = false;

const defaultScales = [
  { id: 'linear-1-8', name: 'Linear 1-8', values: ['1', '2', '3', '4', '5', '6', '7', '8', '?'] },
  { id: 'fibonacci', name: 'Fibonacci', values: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?'] },
  { id: 'tshirt', name: 'T-Shirt', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?'] },
  { id: 'days', name: 'Days', values: ['1', '2', '3', '5', '8', '13', '?'] },
];

const CUSTOM_SCALE_ID = '__custom__';
const themeKey = 'scrum-poker-theme';
const themeHintKey = 'scrum-poker-theme-hint-seen';
const THEME_HINT_INTERVAL_MS = 60 * 24 * 60 * 60 * 1000;
// Bump this when the default theme changes so existing visitors get it once.
const themeDefaultVersionKey = 'scrum-poker-theme-default-version';
const THEME_DEFAULT_VERSION = 'light-1';

function applyThemeDefaultMigration() {
  try {
    if (window.localStorage.getItem(themeDefaultVersionKey) === THEME_DEFAULT_VERSION) return;
    window.localStorage.removeItem(themeKey);
    window.localStorage.setItem(themeDefaultVersionKey, THEME_DEFAULT_VERSION);
  } catch (error) {}
}

applyThemeDefaultMigration();

function getInitials(value) {
  const parts = (value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function getAvatarStyle(value) {
  const source = (value || '?').trim() || '?';
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) % 360;
  }
  return {
    background: `linear-gradient(135deg, hsl(${hash} 72% 56%), hsl(${(hash + 48) % 360} 72% 42%))`,
  };
}

function formatMetric(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="3.5" width="11" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="9" y="6" width="11" height="15" rx="2.5" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 10.5h5M12 13.5h5M12 16.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15 8V6.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function ViewerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

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
  const [roomCode, setRoomCode] = useState(() => {
    try {
      return (new URLSearchParams(window.location.search).get('room') || '').toUpperCase();
    } catch (error) {
      return '';
    }
  });
  const [roomTitle, setRoomTitle] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('title') || 'Sprint Planning';
    } catch (error) {
      return 'Sprint Planning';
    }
  });
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
      const fromUrl = new URLSearchParams(window.location.search).get('scale');
      if (fromUrl) return fromUrl;
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
  const [hostId, setHostId] = useState('');
  const [joinRole, setJoinRole] = useState('participant');
  const [myRole, setMyRole] = useState('participant');
  const [theme, setTheme] = useState(() => {
    try {
      const stored = window.localStorage.getItem(themeKey);
      if (stored === 'light' || stored === 'dark') return stored;
      return 'light';
    } catch (error) {
      return 'light';
    }
  });
  const [showThemeHint, setShowThemeHint] = useState(() => {
    try {
      const lastShownAt = Number(window.localStorage.getItem(themeHintKey));
      if (!Number.isFinite(lastShownAt) || lastShownAt <= 0) return true;
      return Date.now() - lastShownAt >= THEME_HINT_INTERVAL_MS;
    } catch (error) {
      return true;
    }
  });

  const roomCodeRef = useRef(roomCode);
  const roomTitleRef = useRef(roomTitle);
  const selectedScaleIdRef = useRef(selectedScaleId);
  const revealedRef = useRef(revealed);
  const hostOnlyRef = useRef(hostOnly);
  const votesRef = useRef(votes);
  const participantsRef = useRef(participants);
  const isHostRef = useRef(isHost);
  const hostIdRef = useRef(hostId);
  const roleRef = useRef(myRole);
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

  // Join mode follows the room-code field: entering a code shows the
  // Participant/Viewer options and hides "Create room"; clearing it brings
  // "Create room" back. Do not derive this from the URL, because the URL is
  // written from this same state and would keep the page stuck in join mode.
  const hasRoomParam = Boolean(roomCode.trim());

  useEffect(() => {
    roomCodeRef.current = roomCode;
    roomTitleRef.current = roomTitle;
    selectedScaleIdRef.current = selectedScaleId;
    revealedRef.current = revealed;
    hostOnlyRef.current = hostOnly;
    votesRef.current = votes;
    participantsRef.current = participants;
    isHostRef.current = isHost;
    hostIdRef.current = hostId;
    roleRef.current = myRole;
    selectedVoteRef.current = selectedVote;
    joinedRef.current = joined;
    nameRef.current = name;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(themeKey, theme);
    } catch (error) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'light' ? '#eef2ff' : '#0f172a');
    }
  }, [theme]);

  useEffect(() => {
    if (!showThemeHint) return;
    try {
      // Remember when the tip was shown so it only reappears after the reminder window.
      window.localStorage.setItem(themeHintKey, String(Date.now()));
    } catch (error) {}
  }, [showThemeHint]);

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
      hostId: hostIdRef.current,
      role: roleRef.current,
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
    hostId: hostIdRef.current,
    role: roleRef.current,
    selectedScaleId: selectedScaleIdRef.current,
  }), []);

  const registerPresence = useCallback(async (code, id, participantName, role = roleRef.current) => {
    if (!database || !code || !id) return;
    const codeValue = code.toUpperCase();
    const now = Date.now();
    const isViewer = role === 'viewer';
    const cachedVote = votesRef.current.find((entry) => entry.id === id)?.vote ?? null;
    const updates = {
      [`participants/${id}`]: { name: participantName, online: true, lastSeen: now, role },
      [`votes/${id}`]: isViewer ? null : { name: participantName, vote: cachedVote },
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
      participantDisconnect.remove();
      participantDisconnectRef.current = participantDisconnect;
      if (!isViewer) {
        const voteDisconnect = onDisconnect(ref(database, `rooms/${codeValue}/votes/${id}`));
        voteDisconnect.remove();
        voteDisconnectRef.current = voteDisconnect;
      }
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
      await registerPresence(codeValue, id, nameToUse, roleRef.current);
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
    setHostId(remoteRoom.hostId || '');
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
    const ownParticipant = ownId ? remoteRoom.participants[ownId] : null;
    const participantPresent = Boolean(ownParticipant);
    const ownRole = ownParticipant?.role || roleRef.current;
    const votePresent = ownId && remoteRoom.votes.some((entry) => entry.id === ownId);
    const cachedOwnVote = votesRef.current.find((entry) => entry.id === ownId)?.vote;
    const missingOwnVote = ownRole !== 'viewer' && !votePresent && Boolean(cachedOwnVote);
    const roleMismatch = participantPresent && ownRole !== roleRef.current;
    if (joinedRef.current && ownId && (!participantPresent || missingOwnVote || roleMismatch)) {
      registerPresence(roomCodeRef.current, ownId, nameRef.current, roleRef.current);
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
    const roomValue = roomCode.trim();
    // Mirror the field into the URL, and remove the param when the field is
    // empty. Never fall back to the previous URL value, or clearing the code
    // would leave ?room=... behind and the page would stay in join mode.
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
        setHostId(roomFields.hostId || '');
        const restoredRole = parsed.role === 'viewer' || roomFields.participants[participantIdRef.current]?.role === 'viewer'
          ? 'viewer'
          : 'participant';
        setMyRole(restoredRole);
        roleRef.current = restoredRole;
        setJoinRole(restoredRole);

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
      [nextParticipantId]: { id: nextParticipantId, name, online: true, lastSeen: now, role: 'participant' },
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
        [nextParticipantId]: { name, online: true, lastSeen: now, role: 'participant' },
      },
    };

    setRoomCode(nextRoomCode);
    setJoined(true);
    joinedRef.current = true;
    setIsHost(true);
    setHostId(nextParticipantId);
    setMyRole('participant');
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
      hostId: nextParticipantId,
      role: 'participant',
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
    const nextRole = joinRole === 'viewer' ? 'viewer' : 'participant';
    const isViewerJoin = nextRole === 'viewer';

    const entry = { id: nextParticipantId, name, vote: null };
    const existingVotes = dedupeVotesByName(existingRoom.votes || [], name)
      .filter((voteEntry) => voteEntry.id !== nextParticipantId);
    const nextVotes = isViewerJoin ? existingVotes : upsertVoteEntry(existingVotes, entry);
    const nextParticipants = {
      ...(existingRoom.participants || {}),
      [nextParticipantId]: { id: nextParticipantId, name, online: true, lastSeen: Date.now(), role: nextRole },
    };
    const roomScaleId = existingRoom.selectedScaleId
      || (selectedScaleId === CUSTOM_SCALE_ID ? defaultScales[0].id : selectedScaleId)
      || defaultScales[0].id;
    persistScalePreference(roomScaleId);

    setRoomCode(nextRoomCode);
    setJoined(true);
    joinedRef.current = true;
    setIsHost(existingRoom.hostId === nextParticipantId);
    setHostId(existingRoom.hostId || '');
    setMyRole(nextRole);
    setRevealed(Boolean(existingRoom.revealed));
    setHostOnly(Boolean(existingRoom.hostOnly));
    setRoomTitle(existingRoom.roomTitle || roomTitle || 'Sprint Planning');
    setSelectedScaleId(roomScaleId);
    setSelectedVote(null);
    setVotes(nextVotes);
    setParticipants(nextParticipants);
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
      participants: nextParticipants,
      isHost: existingRoom.hostId === nextParticipantId,
      hostId: existingRoom.hostId || '',
      role: nextRole,
      selectedScaleId: roomScaleId,
    });

    if (database) {
      await registerPresence(nextRoomCode, nextParticipantId, name, nextRole);
      setConnectionStatus(isViewerJoin ? 'Watching as viewer' : 'Joined room');
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
    if (roleRef.current === 'viewer') {
      setConnectionStatus('Viewer mode — voting is disabled');
      return;
    }
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

  useEffect(() => {
    if (!joined) return undefined;

    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (roleRef.current === 'viewer') return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))) {
        return;
      }
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= activeScale.values.length) return;
      event.preventDefault();
      submitVote(activeScale.values[index]);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeScale, joined, submitVote]);

  const revealVotes = async () => {
    if (!joined) return;
    if (roleRef.current === 'viewer') return;
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
    if (roleRef.current === 'viewer') return;
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
    setHostId('');
    setMyRole('participant');
    setJoinRole('participant');
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
      registerPresence(roomCode, participantIdRef.current, nameRef.current, roleRef.current);
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
    setHostId('');
    setMyRole('participant');
    setJoinRole('participant');
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

  const copyRoomCode = async () => {
    const code = roomCodeRef.current;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setConnectionStatus('Room code copied');
    } catch (error) {
      console.error('Unable to copy room code', error);
      setConnectionStatus('Unable to copy room code');
    }
  };

  const dismissThemeHint = () => {
    setShowThemeHint(false);
    try {
      window.localStorage.setItem(themeHintKey, String(Date.now()));
    } catch (error) {}
  };

  const toggleTheme = () => {
    dismissThemeHint();
    setTheme((value) => (value === 'dark' ? 'light' : 'dark'));
  };

  const participantEntries = useMemo(() => {
    const entries = [];
    const participantIds = Object.keys(participants);
    if (participantIds.length === 0) {
      for (const voteEntry of votes) {
        entries.push({
          id: voteEntry.id,
          name: voteEntry.name,
          online: true,
          role: 'participant',
          vote: voteEntry.vote,
        });
      }
      return entries;
    }
    for (const [id, participant] of Object.entries(participants)) {
      const voteEntry = votes.find((entry) => entry.id === id);
      entries.push({
        id,
        name: participant.name || voteEntry?.name || '',
        online: Boolean(participant.online),
        role: participant.role === 'viewer' ? 'viewer' : 'participant',
        vote: voteEntry?.vote ?? null,
      });
    }
    return entries;
  }, [participants, votes]);

  const voterEntries = participantEntries.filter((entry) => entry.role !== 'viewer');
  const votedCount = voterEntries.filter((entry) => (
    entry.vote !== null && entry.vote !== undefined && entry.vote !== ''
  )).length;
  const totalCount = voterEntries.length;
  const participantCount = participantEntries.length;
  const viewerCount = participantEntries.length - voterEntries.length;
  const progressPercent = totalCount ? Math.round((votedCount / totalCount) * 100) : 0;
  const connectionWarning = /unavailable|retry|check|saved on this device|unable/i.test(connectionStatus);
  const isViewer = myRole === 'viewer';

  const roundSummary = useMemo(() => {
    if (!revealed) return null;

    const allowedValues = new Set(activeScale.values.map((value) => String(value)));
    const castVotes = participantEntries
      .filter((entry) => entry.role !== 'viewer')
      .map((entry) => entry.vote)
      .filter((vote) => vote !== null && vote !== undefined && vote !== '')
      .map((vote) => String(vote))
      .filter((vote) => allowedValues.has(vote));

    const counts = {};
    for (const vote of castVotes) {
      counts[vote] = (counts[vote] || 0) + 1;
    }

    const numericVotes = castVotes.map(Number).filter((value) => Number.isFinite(value));
    const sortedNumeric = [...numericVotes].sort((a, b) => a - b);
    const average = numericVotes.length
      ? numericVotes.reduce((sum, value) => sum + value, 0) / numericVotes.length
      : null;
    const median = sortedNumeric.length
      ? (
        sortedNumeric[Math.floor((sortedNumeric.length - 1) / 2)]
        + sortedNumeric[Math.ceil((sortedNumeric.length - 1) / 2)]
      ) / 2
      : null;
    const distribution = Object.entries(counts).sort((a, b) => (
      b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true })
    ));
    const topCount = distribution.length ? distribution[0][1] : 0;

    return {
      totalVotes: castVotes.length,
      average,
      median,
      distribution,
      modes: distribution.filter(([, count]) => count === topCount).map(([value]) => value),
      unanimous: castVotes.length > 0 && Object.keys(counts).length === 1,
      consensus: castVotes.length > 0 && topCount > castVotes.length / 2,
    };
  }, [activeScale, participantEntries, revealed]);

  const sessionActions = (
    <>
      {!isViewer && (!hostOnly || isHost) ? (
        <>
          <button aria-pressed={revealed} onClick={revealVotes}>{revealed ? 'Hide votes' : 'Reveal votes'}</button>
          <button className="secondary" onClick={resetRound}>Reset round</button>
        </>
      ) : null}
      <button className="ghost" onClick={leaveRoom}>Leave</button>
    </>
  );

  return (
    <div className={joined ? 'app-shell is-joined' : 'app-shell'}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><LogoMark /></span>
          <div className="brand-text">
            <p className="brand-title">Scrum Poker</p>
            <p className="brand-subtitle">Planning, simplified</p>
          </div>
        </div>
        <div className="topbar-actions">
          {joined && roomCode ? (
            <button className="room-chip" onClick={copyRoomCode} aria-label={`Copy room code ${roomCode}`} title="Copy room code">
              <span className="room-label">Room</span>
              <span className="room-code">{roomCode}</span>
              <CopyIcon />
            </button>
          ) : null}
          <div className="theme-toggle">
            {showThemeHint ? (
              <div className="theme-hint" id="theme-hint" role="note">
                <span className="theme-hint-text">Light or dark — switch themes with this button.</span>
                <button type="button" className="theme-hint-dismiss" onClick={dismissThemeHint}>
                  Got it
                </button>
              </div>
            ) : null}
            <button
              className={`icon-button${showThemeHint ? ' theme-hint-target' : ''}`}
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              aria-describedby={showThemeHint ? 'theme-hint' : undefined}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </header>

      {expired ? (
        <section className="card state-card">
          <p className="eyebrow">Session ended</p>
          <h2>This room has expired</h2>
          <p className="muted">Rooms expire after a period of inactivity. Create a new room to keep planning.</p>
          <div className="button-row">
            <button onClick={resetExpired}>Create a new room</button>
          </div>
        </section>
      ) : !joined ? (
        <div className="landing">
          <section className="card landing-intro">
            <p className="eyebrow">Open Scrum Poker</p>
            <h2>Estimate together.<br />Decide faster.</h2>
            <p className="landing-lead">
              A lightweight planning poker room for your team. No accounts, no setup — share a code and start voting in seconds.
            </p>
            <ul className="feature-list">
              <li className="feature-pill"><span className="feature-dot" aria-hidden="true" />Live sync</li>
              <li className="feature-pill"><span className="feature-dot" aria-hidden="true" />No sign-in</li>
              <li className="feature-pill"><span className="feature-dot" aria-hidden="true" />Installable PWA</li>
            </ul>
            <div className="hero-preview" aria-hidden="true">
              <span className="preview-card">3</span>
              <span className="preview-card">5</span>
              <span className="preview-card">8</span>
            </div>
          </section>

          <section className="card form-card">
            <div className="form-head">
              <h2>{hasRoomParam ? 'Join this room' : 'Create or join a room'}</h2>
              <p className="muted">
                {hasRoomParam ? 'Enter your name to join the session.' : 'Start a new session or enter an existing room code.'}
              </p>
            </div>
            <label>
              <span className="field-label">Your name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex" autoComplete="name" />
            </label>
            {!hasRoomParam ? (
              <label>
                <span className="field-label">Room title</span>
                <input value={roomTitle} onChange={(event) => setRoomTitle(event.target.value)} placeholder="Sprint Planning" />
              </label>
            ) : null}
            <label>
              <span className="field-label">Room code</span>
              <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="AB12" autoComplete="off" />
            </label>
            {hasRoomParam || roomCode.trim() ? (
              <div className="role-picker">
                <span className="field-label" id="join-role-label">Join as</span>
                <div className="role-options" role="radiogroup" aria-labelledby="join-role-label">
                  <label className={`role-option ${joinRole === 'participant' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="join-role"
                      value="participant"
                      checked={joinRole === 'participant'}
                      onChange={() => setJoinRole('participant')}
                    />
                    <span className="role-option-body">
                      <span className="role-option-title">Participant</span>
                      <span className="role-option-desc">Cast a vote each round.</span>
                    </span>
                  </label>
                  <label className={`role-option ${joinRole === 'viewer' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="join-role"
                      value="viewer"
                      checked={joinRole === 'viewer'}
                      onChange={() => setJoinRole('viewer')}
                    />
                    <span className="role-option-body">
                      <span className="role-option-title">Viewer</span>
                      <span className="role-option-desc">Watch live without voting.</span>
                    </span>
                  </label>
                </div>
              </div>
            ) : null}
            {!hasRoomParam ? (
              <>
                <label>
                  <span className="field-label">Estimation scale</span>
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
              <button className={hasRoomParam ? '' : 'secondary'} onClick={joinRoom}>Join room</button>
            </div>
            {joinError ? <p className="form-error" role="alert">{joinError}</p> : null}
            <p className="muted form-hint">
              {hasRoomParam ? 'You will join the session as soon as you enter your name.' : 'Share the host’s room link, or use a room code to join.'}
            </p>
          </section>
        </div>
      ) : (
        <>
          <section className="card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Live session</p>
                <h2 className="session-title">{roomTitle}</h2>
                <div className="session-meta">
                  <span className={`badge ${isHost ? 'host' : isViewer ? 'viewer' : ''}`}>
                    {isHost ? 'Host' : isViewer ? 'Viewer' : 'Participant'}
                  </span>
                  {hostOnly ? <span className="badge">Host-only controls</span> : null}
                </div>
              </div>
              <div className="session-actions session-actions-desktop">
                {sessionActions}
              </div>
            </div>
            <p className="muted welcome-line">
              Welcome, {name}.{' '}
              {isHost
                ? 'You are hosting this room.'
                : isViewer
                  ? 'You are watching this session without voting.'
                  : 'You are joining as a participant.'}
              {isViewer
                ? ' Viewer mode is read-only, so you will not cast a vote.'
                : hostOnly && !isHost
                  ? ' Only the host can reveal or reset the round.'
                  : ''}
            </p>
            <div className="vote-progress">
              <div className="progress-head">
                <span><strong>{votedCount}</strong> of {totalCount} voted{viewerCount ? ` · ${viewerCount} watching` : ''}</span>
                <span>{revealed ? 'Votes revealed' : 'Waiting for votes'}</span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax={totalCount}
                aria-valuenow={votedCount}
                aria-label="Votes submitted"
              >
                <div className="progress-bar" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
            <div className="status-row">
              <p className={`connection-status ${connectionWarning ? 'warn' : ''}`} role="status" aria-live="polite">
                <span className={`status-dot ${connectionWarning ? 'warn' : ''}`} aria-hidden="true" />
                {connectionStatus}
              </p>
              {canRetry ? <button className="ghost" onClick={retryConnection}>Retry connection</button> : null}
            </div>
            {isHost && joinLink ? (
              <div className="share-box">
                <span>{joinLink}</span>
                <button className="secondary" onClick={copyInviteLink}>Copy invite link</button>
              </div>
            ) : null}

            {SHOW_ROUND_SUMMARY && revealed && roundSummary ? (
              <div className="round-summary">
                <div className="summary-head">
                  <h3>Round summary</h3>
                  <span className={`summary-badge ${roundSummary.unanimous ? 'ok' : roundSummary.consensus ? 'majority' : 'split'}`}>
                    {roundSummary.totalVotes === 0
                      ? 'No votes'
                      : roundSummary.unanimous
                        ? 'Unanimous'
                        : roundSummary.consensus
                          ? 'Majority'
                          : 'Split'}
                  </span>
                </div>
                <div className="summary-metrics">
                  <div className="metric">
                    <p className="metric-label">Average</p>
                    <p className="metric-value">{formatMetric(roundSummary.average)}</p>
                  </div>
                  <div className="metric">
                    <p className="metric-label">Median</p>
                    <p className="metric-value">{formatMetric(roundSummary.median)}</p>
                  </div>
                  <div className="metric">
                    <p className="metric-label">Mode</p>
                    <p className="metric-value">{roundSummary.modes.length ? roundSummary.modes.join(', ') : '—'}</p>
                  </div>
                </div>
                {roundSummary.distribution.length ? (
                  <div className="distribution">
                    {roundSummary.distribution.map(([value, count]) => (
                      <div className="distribution-row" key={value}>
                        <span className="distribution-value">{value}</span>
                        <span className="distribution-track">
                          <span className="distribution-fill" style={{ width: `${(count / roundSummary.totalVotes) * 100}%` }} />
                        </span>
                        <span className="distribution-count">{count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-summary">No votes were submitted this round.</p>
                )}
              </div>
            ) : null}

            <div className="session-actions session-actions-mobile">
              {sessionActions}
            </div>
          </section>

          <div className="room-body">
            {isViewer ? (
              <section className="card viewer-card">
                <span className="viewer-icon" aria-hidden="true"><ViewerIcon /></span>
                <div className="viewer-copy">
                  <p className="eyebrow">Viewer mode</p>
                  <h3>You’re watching this round</h3>
                  <p className="muted">
                    The vote deck is hidden for viewers. Results appear here and in the participant list when the host reveals the round.
                    Leave and rejoin as a participant if you want to vote.
                  </p>
                </div>
              </section>
            ) : (
              <section className="card">
                <div className="section-head">
                  <div>
                    <h3>Choose your estimate</h3>
                    <p className="muted card-subtitle">Click a card or press its number key.</p>
                  </div>
                  <span className="badge">{activeScale.name}</span>
                </div>
                <div className="card-grid">
                  {activeScale.values.map((value, index) => (
                    <button
                      key={value}
                      className={`vote-card ${selectedVote === value ? 'selected' : ''}`}
                      style={{ animationDelay: `${index * 28}ms` }}
                      aria-pressed={selectedVote === value}
                      aria-label={`Vote ${value}`}
                      aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
                      title={index < 9 ? `Press ${index + 1}` : undefined}
                      onClick={() => submitVote(value)}
                    >
                      {index < 9 ? <span className="vote-key" aria-hidden="true">{index + 1}</span> : null}
                      {value}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="card participants-column">
              <div className="section-head">
                <h3>Participants</h3>
                <span className="badge">{participantCount}</span>
              </div>
              <ul className="participant-list" aria-live="polite" aria-relevant="additions removals">
                {participantEntries.length === 0 ? (
                  <li className="empty-state">No participants yet.</li>
                ) : (
                  participantEntries.map((entry) => {
                    const entryIsViewer = entry.role === 'viewer';
                    const hasVoted = !entryIsViewer
                      && entry.vote !== null
                      && entry.vote !== undefined
                      && entry.vote !== '';
                    const validVote = hasVoted && activeScale.values.map(String).includes(String(entry.vote))
                      ? String(entry.vote)
                      : null;
                    const statusLabel = entryIsViewer
                      ? 'is watching'
                      : revealed
                        ? validVote
                          ? `voted ${validVote}`
                          : 'did not vote'
                        : hasVoted
                          ? 'has voted'
                          : 'has not voted';
                    const voteText = entryIsViewer
                      ? 'Watching'
                      : revealed
                        ? validVote || '—'
                        : hasVoted
                          ? '✓ Voted'
                          : 'Pending';
                    return (
                      <li key={entry.id}>
                        <span className="participant-avatar" style={getAvatarStyle(entry.name)} aria-hidden="true">
                          {getInitials(entry.name)}
                          <span className={`presence-dot ${entry.online ? '' : 'offline'}`} />
                        </span>
                        <span className="participant-main">
                          <span className="participant-name">{entry.name || 'Participant'}</span>
                          <span className="participant-tags">
                            {entry.id === participantIdRef.current ? <span className="mini-badge you">You</span> : null}
                            {entry.id === hostId ? <span className="mini-badge host">Host</span> : null}
                            {entryIsViewer ? <span className="mini-badge viewer">Viewer</span> : null}
                            {!entry.online ? <span className="mini-badge offline">Offline</span> : null}
                            <span className="sr-only">{statusLabel}</span>
                          </span>
                        </span>
                        <span
                          className={`vote-badge ${entryIsViewer ? 'watching' : ''} ${revealed ? 'revealed' : ''} ${!entryIsViewer && !revealed && !hasVoted ? 'pending' : ''} ${!entryIsViewer && !revealed && hasVoted ? 'voted' : ''}`}
                          aria-hidden="true"
                        >
                          {voteText}
                        </span>
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

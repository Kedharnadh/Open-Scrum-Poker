import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Peer } from 'peerjs';

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

function calculateAverage(values) {
  if (!values.length) return '—';
  const sum = values.reduce((total, value) => total + value, 0);
  return (sum / values.length).toFixed(1);
}

function calculateMedian(values) {
  if (!values.length) return '—';
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] + sorted[middle]) / 2).toFixed(1);
  }
  return sorted[middle].toFixed(1);
}

function upsertVoteEntry(votes, entry) {
  const nextVotes = votes.filter((item) => item.id !== entry.id);
  return [...nextVotes, entry];
}

function removeParticipantVote(votes, participantId) {
  return votes.filter((item) => item.id !== participantId);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function buildJoinLink(roomCode, hostPeerId, roomTitle, selectedScaleId) {
  const params = new URLSearchParams(window.location.search);
  params.set('room', roomCode);
  params.set('host', hostPeerId);
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
  const [peerId, setPeerId] = useState('');
  const [hostPeerId, setHostPeerId] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('Ready to connect');
  const [joinLink, setJoinLink] = useState('');
  const [selectedScaleId, setSelectedScaleId] = useState(defaultScales[0].id);
  const [customScales, setCustomScales] = useState([]);
  const [customScaleName, setCustomScaleName] = useState('');
  const [customScaleValuesInput, setCustomScaleValuesInput] = useState('');

  const peerRef = useRef(null);
  const connectionRef = useRef(null);
  const connectionsRef = useRef(new Map());
  const roomCodeRef = useRef(roomCode);
  const revealedRef = useRef(revealed);
  const roomTitleRef = useRef(roomTitle);
  const selectedScaleIdRef = useRef(selectedScaleId);

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
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) {
        const params = new URLSearchParams(window.location.search);
        const roomFromUrl = params.get('room');
        const hostFromUrl = params.get('host');
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
        if (hostFromUrl) {
          setHostPeerId(hostFromUrl);
          setJoinLink(buildJoinLink(roomFromUrl || '', hostFromUrl, titleFromUrl || '', scaleFromUrl || ''));
        }
        if (roomFromUrl && hostFromUrl) {
          setName('Guest');
          setJoined(true);
          setIsHost(false);
          setRevealed(false);
          setSelectedVote(null);
          setVotes([]);
          setConnectionStatus('Connecting to host');
          setTimeout(() => initializePeer('participant'), 0);
        }
        return;
      }

      const parsed = JSON.parse(saved);
      setName(parsed.name || '');
      setRoomCode(parsed.roomCode || '');
      setRoomTitle(parsed.roomTitle || 'Sprint Planning');
      setJoined(Boolean(parsed.joined));
      setRevealed(Boolean(parsed.revealed));
      setSelectedVote(parsed.selectedVote ?? null);
      setVotes(parsed.votes || []);
      setIsHost(Boolean(parsed.isHost));
      setSelectedScaleId(parsed.selectedScaleId || defaultScales[0].id);
      setCustomScales(parsed.customScales || []);
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
    if (joinLink) {
      params.set('host', new URL(joinLink).searchParams.get('host') || '');
    }
    if (selectedScaleId) {
      params.set('scale', selectedScaleId);
    }
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [roomCode, roomTitle, joinLink, selectedScaleId]);

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
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [name, roomCode, roomTitle, joined, revealed, selectedVote, votes, isHost, selectedScaleId, customScales]);

  const disconnectPeer = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    connectionRef.current = null;
    connectionsRef.current.clear();
    setPeerId('');
    setHostPeerId('');
  }, []);

  const broadcastState = useCallback((nextVotes, nextRevealed, nextRoomTitle, nextScaleId) => {
    const payload = {
      type: 'state',
      roomCode: roomCodeRef.current,
      roomTitle: nextRoomTitle,
      selectedScaleId: nextScaleId,
      revealed: nextRevealed,
      votes: nextVotes,
    };

    connectionsRef.current.forEach((connection) => {
      if (connection?.open) {
        connection.send(payload);
      }
    });
  }, []);

  const initializePeer = useCallback((role) => {
    if (peerRef.current) {
      return;
    }

    const peer = new Peer(undefined, {
      host: '0.peerjs.com',
      port: 443,
      secure: true,
      path: '/',
    });

    peer.on('open', (id) => {
      setPeerId(id);
      setConnectionStatus(role === 'host' ? 'Hosting room' : 'Connecting to host');
      if (role === 'host') {
        const nextLink = buildJoinLink(roomCodeRef.current, id, roomTitleRef.current, selectedScaleIdRef.current);
        setJoinLink(nextLink);
      }
    });

    peer.on('connection', (connection) => {
      connectionRef.current = connection;
      connectionsRef.current.set(connection.peer, connection);
      setConnectionStatus('Participant connected');

      connection.on('open', () => {
        const initialPayload = {
          type: 'state',
          roomCode: roomCodeRef.current,
          roomTitle: roomTitleRef.current,
          selectedScaleId: selectedScaleIdRef.current,
          revealed: revealedRef.current,
          votes,
        };
        connection.send(initialPayload);
      });

      connection.on('data', (payload) => {
        if (payload?.type === 'join' || payload?.type === 'vote') {
          const entry = payload.entry || {
            id: connection.peer,
            name: payload.name || `Guest ${connection.peer.slice(0, 4)}`,
            vote: payload.vote ?? null,
          };

          setVotes((current) => {
            const nextVotes = upsertVoteEntry(current, entry);
            broadcastState(nextVotes, revealedRef.current, roomTitleRef.current, selectedScaleIdRef.current);
            return nextVotes;
          });
        }

        if (payload?.type === 'leave') {
          setVotes((current) => {
            const nextVotes = removeParticipantVote(current, payload.id || connection.peer);
            broadcastState(nextVotes, revealedRef.current, roomTitleRef.current, selectedScaleIdRef.current);
            return nextVotes;
          });
        }

        if (payload?.type === 'state') {
          setRevealed(Boolean(payload.revealed));
          setRoomTitle(payload.roomTitle || roomTitleRef.current);
          setSelectedScaleId(payload.selectedScaleId || selectedScaleIdRef.current);
          setVotes(payload.votes || []);
        }
      });

      connection.on('close', () => {
        connectionsRef.current.delete(connection.peer);
        setVotes((current) => {
          const nextVotes = removeParticipantVote(current, connection.peer);
          broadcastState(nextVotes, revealedRef.current, roomTitleRef.current, selectedScaleIdRef.current);
          return nextVotes;
        });
        setConnectionStatus('A participant disconnected');
      });
    });

    peer.on('error', (error) => {
      setConnectionStatus(error.message || 'Connection error');
    });

    peerRef.current = peer;
  }, [broadcastState, votes]);

  const connectToHost = useCallback((hostPeerIdValue) => {
    if (!peerRef.current || !hostPeerIdValue) {
      return;
    }

    const connection = peerRef.current.connect(hostPeerIdValue, {
      reliable: true,
    });

    connection.on('open', () => {
      connectionRef.current = connection;
      setConnectionStatus('Connected to host');
      const joinPayload = {
        type: 'join',
        name,
        vote: selectedVote ?? null,
        entry: {
          id: peerId || connection.peer,
          name,
          vote: selectedVote ?? null,
        },
      };
      connection.send(joinPayload);
    });

    connection.on('error', () => {
      setConnectionStatus('Could not reach the host. Please refresh and try again.');
    });

    connection.on('data', (payload) => {
      if (payload?.type === 'state') {
        setRevealed(Boolean(payload.revealed));
        setRoomTitle(payload.roomTitle || roomTitleRef.current);
        setSelectedScaleId(payload.selectedScaleId || selectedScaleIdRef.current);
        setVotes(payload.votes || []);
      }
    });

    connection.on('close', () => {
      setConnectionStatus('Disconnected from host');
    });
  }, [name, peerId, selectedVote]);

  const scaleOptions = useMemo(() => [...defaultScales, ...customScales], [customScales]);
  const activeScale = useMemo(() => {
    const scale = scaleOptions.find((item) => item.id === selectedScaleId);
    return scale || defaultScales[0];
  }, [scaleOptions, selectedScaleId]);

  const numericVotes = useMemo(() => {
    return votes
      .map((entry) => Number(entry.vote))
      .filter((value) => !Number.isNaN(value));
  }, [votes]);

  useEffect(() => {
    if (!joined || !isHost || !peerId || !roomCode) return;
    setJoinLink(buildJoinLink(roomCode, peerId, roomTitle, selectedScaleId));
  }, [joined, isHost, peerId, roomCode, roomTitle, selectedScaleId]);

  const createRoom = () => {
    const nextRoom = generateRoomCode();
    setRoomCode(nextRoom);
    setIsHost(true);
    setRevealed(false);
    setSelectedVote(null);
    setVotes([]);
    setJoined(true);
    setConnectionStatus('Preparing live room');
    setTimeout(() => initializePeer('host'), 0);
  };

  const joinRoom = () => {
    if (!name.trim() || !roomCode.trim()) return;
    const params = new URLSearchParams(window.location.search);
    const hostFromUrl = params.get('host');
    if (hostFromUrl) {
      setHostPeerId(hostFromUrl);
    }
    setIsHost(false);
    setRevealed(false);
    setSelectedVote(null);
    setVotes([]);
    setJoined(true);
    setConnectionStatus('Connecting to host');
    setTimeout(() => initializePeer('participant'), 0);
  };

  useEffect(() => {
    if (!joined || isHost || !hostPeerId || !peerId) return;
    connectToHost(hostPeerId);
  }, [joined, isHost, hostPeerId, peerId, connectToHost]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hostFromUrl = params.get('host');
    if (hostFromUrl) {
      setHostPeerId(hostFromUrl);
    }
  }, []);

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

  const submitVote = (value) => {
    if (!joined) return;
    const normalizedVote = String(value);
    setSelectedVote(normalizedVote);

    const entry = {
      id: peerId || `${name}-${Date.now()}`,
      name,
      vote: normalizedVote,
    };

    setVotes((current) => {
      const nextVotes = upsertVoteEntry(current, entry);
      if (isHost) {
        broadcastState(nextVotes, revealedRef.current, roomTitleRef.current, selectedScaleIdRef.current);
      } else if (connectionRef.current?.open) {
        connectionRef.current.send({ type: 'vote', entry });
      }
      return nextVotes;
    });
  };

  const revealVotes = () => {
    const nextValue = !revealed;
    setRevealed(nextValue);
    if (isHost) {
      broadcastState(votes, nextValue, roomTitleRef.current, selectedScaleIdRef.current);
    } else if (connectionRef.current?.open) {
      connectionRef.current.send({ type: 'vote', entry: { id: peerId || `${name}-${Date.now()}`, name, vote: selectedVote ?? null } });
    }
  };

  const resetRound = () => {
    setSelectedVote(null);
    setRevealed(false);
    const nextVotes = votes.map((entry) => ({ ...entry, vote: null }));
    setVotes(nextVotes);
    if (isHost) {
      broadcastState(nextVotes, false, roomTitleRef.current, selectedScaleIdRef.current);
    }
  };

  const addDemoVote = () => {
    const demoName = `Guest ${votes.length + 1}`;
    const demoVote = activeScale.values[Math.floor(Math.random() * activeScale.values.length)];
    const entry = { id: `${demoName}-${Date.now()}`, name: demoName, vote: demoVote };
    setVotes((current) => {
      const nextVotes = upsertVoteEntry(current, entry);
      if (isHost) {
        broadcastState(nextVotes, revealedRef.current, roomTitleRef.current, selectedScaleIdRef.current);
      }
      return nextVotes;
    });
  };

  const leaveRoom = () => {
    if (connectionRef.current?.open) {
      connectionRef.current.send({ type: 'leave', id: peerId || `${name}-${Date.now()}`, name });
    }
    disconnectPeer();
    setJoined(false);
    setVotes([]);
    setSelectedVote(null);
    setRevealed(false);
    setRoomCode('');
    setIsHost(false);
    setHostPeerId('');
    setJoinLink('');
    setConnectionStatus('Ready to connect');
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
          <p className="eyebrow">GitHub Pages • Live sync</p>
          <h1>{roomTitle || 'Scrum Poker Room'}</h1>
          <p>Join from a second device and watch the room update in real time.</p>
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
            <button onClick={createRoom}>Create room</button>
            <button className="secondary" onClick={joinRoom}>Join room</button>
          </div>
          <p className="muted status-line">Use the same room code plus the invite link from the host to sync across devices.</p>
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

          <section className="card stats-card">
            <div className="stats-grid">
              <div>
                <p className="eyebrow">Votes</p>
                <h3>{votes.length}</h3>
              </div>
              <div>
                <p className="eyebrow">Average</p>
                <h3>{calculateAverage(numericVotes)}</h3>
              </div>
              <div>
                <p className="eyebrow">Median</p>
                <h3>{calculateMedian(numericVotes)}</h3>
              </div>
            </div>
            <div className="button-row compact">
              <button className="secondary" onClick={addDemoVote}>Add demo vote</button>
            </div>
          </section>

          <section className="card">
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
        </>
      )}
    </div>
  );
}

export default App;

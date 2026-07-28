import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Peer } from 'peerjs';

const cardValues = ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?'];
const storageKey = 'scrum-poker-demo-state-v1';

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

function buildJoinLink(roomCode, hostPeerId) {
  const params = new URLSearchParams(window.location.search);
  params.set('room', roomCode);
  params.set('host', hostPeerId);
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

function App() {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [selectedVote, setSelectedVote] = useState(null);
  const [votes, setVotes] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [peerId, setPeerId] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('Ready to connect');
  const [joinLink, setJoinLink] = useState('');

  const peerRef = useRef(null);
  const connectionRef = useRef(null);
  const connectionsRef = useRef(new Map());
  const roomCodeRef = useRef(roomCode);
  const revealedRef = useRef(revealed);
  const nameRef = useRef(name);

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) {
        const params = new URLSearchParams(window.location.search);
        const roomFromUrl = params.get('room');
        const hostFromUrl = params.get('host');
        if (roomFromUrl) {
          setRoomCode(roomFromUrl.toUpperCase());
        }
        if (hostFromUrl) {
          setJoinLink(buildJoinLink(roomFromUrl || '', hostFromUrl));
        }
        return;
      }

      const parsed = JSON.parse(saved);
      setName(parsed.name || '');
      setRoomCode(parsed.roomCode || '');
      setJoined(Boolean(parsed.joined));
      setRevealed(Boolean(parsed.revealed));
      setSelectedVote(parsed.selectedVote ?? null);
      setVotes(parsed.votes || []);
      setIsHost(Boolean(parsed.isHost));
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
    if (joinLink) {
      params.set('host', new URL(joinLink).searchParams.get('host') || '');
    }
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [roomCode, joinLink]);

  useEffect(() => {
    const payload = { name, roomCode, joined, revealed, selectedVote, votes, isHost };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [name, roomCode, joined, revealed, selectedVote, votes, isHost]);

  const disconnectPeer = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    connectionRef.current = null;
    connectionsRef.current.clear();
  }, []);

  const broadcastState = useCallback((nextVotes, nextRevealed) => {
    const payload = {
      type: 'state',
      roomCode: roomCodeRef.current,
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
        const nextLink = buildJoinLink(roomCodeRef.current, id);
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
            broadcastState(nextVotes, revealedRef.current);
            return nextVotes;
          });
        }

        if (payload?.type === 'state') {
          setRevealed(Boolean(payload.revealed));
          setVotes(payload.votes || []);
        }
      });

      connection.on('close', () => {
        connectionsRef.current.delete(connection.peer);
        setConnectionStatus('A participant disconnected');
      });
    });

    peer.on('error', (error) => {
      setConnectionStatus(error.message || 'Connection error');
    });

    peerRef.current = peer;
  }, [broadcastState, votes]);

  const connectToHost = useCallback((hostPeerId) => {
    if (!peerRef.current || !hostPeerId) {
      return;
    }

    const connection = peerRef.current.connect(hostPeerId, {
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

    connection.on('data', (payload) => {
      if (payload?.type === 'state') {
        setRevealed(Boolean(payload.revealed));
        setVotes(payload.votes || []);
      }
    });

    connection.on('close', () => {
      setConnectionStatus('Disconnected from host');
    });
  }, [name, peerId, selectedVote]);

  const numericVotes = useMemo(() => votes.map((entry) => Number(entry.vote)).filter((value) => !Number.isNaN(value)), [votes]);

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
    setIsHost(false);
    setRevealed(false);
    setSelectedVote(null);
    setVotes([]);
    setJoined(true);
    setConnectionStatus('Connecting to host');
    setTimeout(() => initializePeer('participant'), 0);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hostFromUrl = params.get('host');
    if (joined && !isHost && hostFromUrl && peerRef.current?.open) {
      connectToHost(hostFromUrl);
    }
  }, [joined, isHost, connectToHost]);

  useEffect(() => {
    if (!joined || isHost || !roomCode) return;
    const params = new URLSearchParams(window.location.search);
    const hostFromUrl = params.get('host');
    if (hostFromUrl && peerRef.current?.open) {
      connectToHost(hostFromUrl);
    }
  }, [joined, isHost, roomCode, connectToHost]);

  useEffect(() => {
    if (!joined || !isHost) return;
    const params = new URLSearchParams(window.location.search);
    const hostFromUrl = params.get('host');
    if (hostFromUrl) {
      setJoinLink(buildJoinLink(roomCode, hostFromUrl));
    }
  }, [joined, isHost, roomCode]);

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
        broadcastState(nextVotes, revealedRef.current);
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
      broadcastState(votes, nextValue);
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
      broadcastState(nextVotes, false);
    }
  };

  const addDemoVote = () => {
    const demoName = `Guest ${votes.length + 1}`;
    const demoVote = cardValues[Math.floor(Math.random() * cardValues.length)];
    const entry = { id: `${demoName}-${Date.now()}`, name: demoName, vote: demoVote };
    setVotes((current) => {
      const nextVotes = upsertVoteEntry(current, entry);
      if (isHost) {
        broadcastState(nextVotes, revealedRef.current);
      }
      return nextVotes;
    });
  };

  const leaveRoom = () => {
    disconnectPeer();
    setJoined(false);
    setVotes([]);
    setSelectedVote(null);
    setRevealed(false);
    setRoomCode('');
    setIsHost(false);
    setPeerId('');
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
          <h1>Scrum Poker Demo</h1>
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
            Room code
            <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="AB12" />
          </label>
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
                <h2>{roomCode}</h2>
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
              {cardValues.map((value) => (
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

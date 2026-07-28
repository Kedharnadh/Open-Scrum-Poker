import { useEffect, useMemo, useState } from 'react';

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

function App() {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [selectedVote, setSelectedVote] = useState(null);
  const [votes, setVotes] = useState([]);
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) {
        const params = new URLSearchParams(window.location.search);
        const roomFromUrl = params.get('room');
        if (roomFromUrl) {
          setRoomCode(roomFromUrl.toUpperCase());
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
    if (roomCode) {
      params.set('room', roomCode);
    } else {
      params.delete('room');
    }
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [roomCode]);

  useEffect(() => {
    const payload = { name, roomCode, joined, revealed, selectedVote, votes, isHost };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [name, roomCode, joined, revealed, selectedVote, votes, isHost]);

  const numericVotes = useMemo(() => votes.map((entry) => Number(entry.vote)).filter((value) => !Number.isNaN(value)), [votes]);

  const createRoom = () => {
    const nextRoom = generateRoomCode();
    setRoomCode(nextRoom);
    setIsHost(true);
    setRevealed(false);
    setSelectedVote(null);
    setVotes([]);
    setJoined(true);
  };

  const joinRoom = () => {
    if (!name.trim() || !roomCode.trim()) return;
    setIsHost(false);
    setRevealed(false);
    setSelectedVote(null);
    setVotes([]);
    setJoined(true);
  };

  const submitVote = (value) => {
    if (!joined) return;
    const normalizedVote = String(value);
    setSelectedVote(normalizedVote);
    setVotes((current) => {
      const existing = current.find((entry) => entry.name === name);
      if (existing) {
        return current.map((entry) => (entry.name === name ? { ...entry, vote: normalizedVote } : entry));
      }
      return [...current, { name, vote: normalizedVote }];
    });
  };

  const revealVotes = () => {
    setRevealed((current) => !current);
  };

  const resetRound = () => {
    setSelectedVote(null);
    setRevealed(false);
    setVotes((current) => current.map((entry) => ({ ...entry, vote: null })));
  };

  const addDemoVote = () => {
    const demoName = `Guest ${votes.length + 1}`;
    const demoVote = cardValues[Math.floor(Math.random() * cardValues.length)];
    setVotes((current) => [...current, { name: demoName, vote: demoVote }]);
  };

  const leaveRoom = () => {
    setJoined(false);
    setVotes([]);
    setSelectedVote(null);
    setRevealed(false);
    setRoomCode('');
    setIsHost(false);
  };

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">GitHub Pages • PWA-ready</p>
          <h1>Scrum Poker Demo</h1>
          <p>Plan your next sprint without needing a custom domain or backend setup.</p>
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
                  <li key={`${entry.name}-${entry.vote}`}>
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

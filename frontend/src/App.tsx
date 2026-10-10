import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';

import { getHealth, getRecommendations, predictExpression } from './services/api';
import type { ExpressionLabel, ExpressionPrediction, ListeningGoal, RecommendationItem } from './types';

const expressionOptions: Array<{ value: ExpressionLabel | ''; label: string }> = [
  { value: '', label: 'Manual only' },
  { value: 'happy', label: 'Happy' },
  { value: 'sad', label: 'Sad' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'surprise', label: 'Surprise' },
  { value: 'angry', label: 'Angry' },
  { value: 'fear', label: 'Fear' },
  { value: 'disgust', label: 'Disgust' },
];

const goalOptions: Array<{ value: ListeningGoal; label: string }> = [
  { value: 'comfort_me', label: 'Comfort me' },
  { value: 'lift_my_mood', label: 'Lift my mood' },
  { value: 'match_my_current_vibe', label: 'Match my current vibe' },
  { value: 'help_me_relax', label: 'Help me relax' },
  { value: 'energize_me', label: 'Energize me' },
  { value: 'help_me_focus', label: 'Help me focus' },
];

export function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [apiStatus, setApiStatus] = useState('checking');
  const [expression, setExpression] = useState<ExpressionLabel | ''>('');
  const [prediction, setPrediction] = useState<ExpressionPrediction | null>(null);
  const [goal, setGoal] = useState<ListeningGoal>('help_me_focus');
  const [languages, setLanguages] = useState('English,Hindi,Instrumental');
  const [genres, setGenres] = useState('indie,pop,lofi');
  const [items, setItems] = useState<RecommendationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const currentSelections = useRef({ expression, goal, languages, genres });
  currentSelections.current = { expression, goal, languages, genres };

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        const response = await getHealth();
        if (!cancelled) setApiStatus(response.status);
      } catch {
        if (!cancelled) setApiStatus('offline');
      }
    }

    void checkHealth();
    const intervalId = window.setInterval(checkHealth, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  async function startCamera() {
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser does not support camera access.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraActive(true);
    } catch (requestError) {
      setCameraError(requestError instanceof Error ? requestError.message : 'Camera permission was denied.');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('Camera preview is not ready yet.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
      setCameraError('Could not capture an image from the camera.');
      return;
    }

    await handlePrediction(blob, 'camera-capture.jpg');
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    await handlePrediction(file, file.name);
    event.target.value = '';
  }

  async function handlePrediction(image: Blob, filename: string) {
    setPredicting(true);
    setCameraError(null);
    setError(null);
    setPrediction(null);
    setItems([]);

    try {
      const result = await predictExpression(image, filename);
      setPrediction(result);
      setExpression(result.expression ?? '');
      await requestRecommendations(result.expression);
    } catch (requestError) {
      setCameraError(requestError instanceof Error ? requestError.message : 'Unable to predict expression.');
    } finally {
      setPredicting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestRecommendations(expression || null);
  }

  async function requestRecommendations(selectedExpression: ExpressionLabel | null) {
    setLoading(true);
    setError(null);
    setItems([]);
    const selections = currentSelections.current;

    try {
      const response = await getRecommendations({
        expression: selectedExpression,
        listening_goal: selections.goal,
        languages: splitCsv(selections.languages),
        genres: splitCsv(selections.genres),
        limit: 5,
      });
      setItems(response.items);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to fetch recommendations.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Expression-aware music discovery</p>
          <h1>Moodify</h1>
          <p className="hero-copy">
            Capture a moment, choose your listening goal, and get a playlist shaped by visible expression cues,
            preferences, and track metadata while keeping you in control.
          </p>
        </div>
        <div className={`status-pill ${apiStatus === 'ok' ? 'online' : ''}`}>API: {apiStatus}</div>
      </section>

      <section className="grid">
        <article className="panel camera-panel">
          <p className="eyebrow">Expression input</p>
          <h2>Upload or camera capture</h2>
          <p>
            Capture or upload a clear, front-facing photo. Moodify estimates a visible expression, then builds a
            playlist from that estimate and your listening preferences. Photos are processed without being saved.
          </p>
          <div className="camera-preview">
            <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" />
            {!cameraActive ? <span>Camera preview</span> : null}
          </div>
          <div className="camera-actions">
            {!cameraActive ? (
              <button type="button" onClick={startCamera}>
                Start camera
              </button>
            ) : (
              <button type="button" onClick={stopCamera}>
                Stop camera
              </button>
            )}
            <button type="button" onClick={capturePhoto} disabled={!cameraActive || predicting || loading}>
              {loading ? 'Building playlist...' : predicting ? 'Analyzing photo...' : 'Click photo'}
            </button>
          </div>
          <label className="file-picker">
            Upload image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileSelected}
              disabled={predicting || loading}
            />
          </label>
          {prediction ? (
            <div className="prediction-card">
              <strong>Status: {prediction.status.replaceAll('_', ' ')}</strong>
              <span>
                Expression: {prediction.expression ?? 'not available'} | Confidence:{' '}
                {Math.round(prediction.confidence * 100)}%
              </span>
              <small>Model: {prediction.model_version}</small>
            </div>
          ) : null}
          {cameraError ? <p className="camera-error">{cameraError}</p> : null}
        </article>

        <form className="panel form-panel" onSubmit={handleSubmit}>
          <p className="eyebrow">Playlist preferences</p>
          <h2>Build a playlist</h2>
          <label>
            Expression
            <select value={expression} onChange={(event) => setExpression(event.target.value as ExpressionLabel | '')}>
              {expressionOptions.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Listening goal
            <select value={goal} onChange={(event) => setGoal(event.target.value as ListeningGoal)}>
              {goalOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Languages
            <input value={languages} onChange={(event) => setLanguages(event.target.value)} />
          </label>
          <label>
            Genres
            <input value={genres} onChange={(event) => setGenres(event.target.value)} />
          </label>
          <button type="submit" disabled={loading || predicting}>
            {loading ? 'Ranking...' : 'Get recommendations'}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </section>

      <section className="panel results-panel">
        <div className="results-heading">
          <p className="eyebrow">Ranked output</p>
          <h2>Recommended tracks</h2>
        </div>
        {items.length === 0 ? (
          <p className="empty-state">
            {predicting || loading
              ? 'Building your playlist…'
              : 'Upload or capture a photo to get recommendations, or choose your preferences and build a playlist.'}
          </p>
        ) : (
          <ol className="track-list">
            {items.map((item) => (
              <li key={item.track.id}>
                <span className="rank">#{item.rank}</span>
                <div>
                  <h3>{item.track.title}</h3>
                  <p>
                    {item.track.artist} | {item.track.language} | {item.track.genre} | score {item.score}
                  </p>
                  <small>{item.reasons.join(' | ')}</small>
                  {item.track.source_url ? (
                    <div className="track-player">
                      <audio controls preload="none" src={item.track.source_url}>
                        <a href={item.track.source_url}>Play {item.track.title}</a>
                      </audio>
                      <a href={item.track.source_url} target="_blank" rel="noreferrer">
                        Open song
                      </a>
                    </div>
                  ) : (
                    <p className="unavailable-track">No playable source configured yet.</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

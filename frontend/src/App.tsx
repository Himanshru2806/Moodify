import { ChangeEvent, useEffect, useRef, useState } from 'react';

import { getHealth, predictExpression } from './services/api';
import {
  clearPersonalDataset,
  createContributionId,
  deletePersonalDatasetContribution,
  listPersonalDatasetContributions,
  savePersonalDatasetContribution,
} from './services/personalDataset';
import { getPlaylistChoices } from './services/playlistOptions';
import { getYouTubePlaylistSearchUrl } from './services/streaming';
import type { ExpressionLabel, ExpressionPrediction } from './types';
import type { PersonalDatasetContribution } from './services/personalDataset';

const expressionOptions: Array<{ value: ExpressionLabel | ''; label: string }> = [
  { value: '', label: 'No specific mood' },
  { value: 'happy', label: 'Happy' },
  { value: 'sad', label: 'Sad' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'surprise', label: 'Surprise' },
  { value: 'angry', label: 'Angry' },
  { value: 'fear', label: 'Fear' },
  { value: 'disgust', label: 'Disgust' },
];

export function App() {
  const [activePage, setActivePage] = useState<'home' | 'dataset' | 'playlists'>(() => {
    if (window.location.hash === '#personal-dataset') return 'dataset';
    if (window.location.hash === '#playlists') return 'playlists';
    return 'home';
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const predictionSectionRef = useRef<HTMLElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const currentPhotoRef = useRef<{ id: string; image: Blob; filename: string } | null>(null);
  const predictionRequestIdRef = useRef(0);
  const [apiStatus, setApiStatus] = useState('checking');
  const [expression, setExpression] = useState<ExpressionLabel | ''>('');
  const [prediction, setPrediction] = useState<ExpressionPrediction | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [contributionConsent, setContributionConsent] = useState(false);
  const [contributionSaving, setContributionSaving] = useState(false);
  const [contributionError, setContributionError] = useState<string | null>(null);
  const [contributionSavedFor, setContributionSavedFor] = useState<{ id: string; expression: ExpressionLabel } | null>(null);
  const [personalDataset, setPersonalDataset] = useState<PersonalDatasetContribution[]>([]);
  const [personalDatasetError, setPersonalDatasetError] = useState<string | null>(null);

  useEffect(() => {
    function updatePageFromHash() {
      if (window.location.hash === '#personal-dataset') {
        setActivePage('dataset');
      } else if (window.location.hash === '#playlists') {
        setActivePage('playlists');
      } else {
        setActivePage('home');
      }
    }

    window.addEventListener('hashchange', updatePageFromHash);
    return () => window.removeEventListener('hashchange', updatePageFromHash);
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    void listPersonalDatasetContributions()
      .then((records) => {
        if (!cancelled) setPersonalDataset(records);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setPersonalDatasetError(loadError instanceof Error ? loadError.message : 'Could not read this browser’s personal dataset.');
        }
      });
    return () => {
      cancelled = true;
    };
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

    event.target.value = '';
    await handlePrediction(file, file.name);
  }

  async function handlePrediction(image: Blob, filename: string) {
    const requestId = ++predictionRequestIdRef.current;
    currentPhotoRef.current = { id: createContributionId(), image, filename };
    setPredicting(true);
    setCameraError(null);
    setPrediction(null);
    setExpression('');
    setContributionConsent(false);
    setContributionError(null);
    setContributionSavedFor(null);

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    predictionSectionRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center',
    });

    try {
      const result = await predictExpression(image, filename);
      if (requestId !== predictionRequestIdRef.current) return;
      setPrediction(result);
      setExpression(result.expression ?? '');
    } catch (requestError) {
      if (requestId === predictionRequestIdRef.current) {
        setCameraError(requestError instanceof Error ? requestError.message : 'Unable to predict expression.');
      }
    } finally {
      if (requestId === predictionRequestIdRef.current) setPredicting(false);
    }
  }

  function showPlaylistChoices() {
    stopCamera();
    window.location.hash = '#playlists';
  }

  function clearPrediction() {
    predictionRequestIdRef.current += 1;
    currentPhotoRef.current = null;
    setPrediction(null);
    setExpression('');
    setPredicting(false);
    setCameraError(null);
    setContributionConsent(false);
    setContributionSaving(false);
    setContributionError(null);
    setContributionSavedFor(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleExpressionCorrection(event: ChangeEvent<HTMLSelectElement>) {
    const correctedExpression = event.target.value as ExpressionLabel | '';
    setExpression(correctedExpression);
    setContributionConsent(false);
    setContributionError(null);
  }

  async function handleSavePersonalContribution() {
    const photo = currentPhotoRef.current;
    if (!photo || !expression || !contributionConsent || predicting || contributionSaving || contributionSavedFor) return;

    const requestId = predictionRequestIdRef.current;
    setContributionSaving(true);
    setContributionError(null);
    try {
      await savePersonalDatasetContribution({
        id: photo.id,
        image: photo.image,
        expression,
      });
      const records = await listPersonalDatasetContributions();
      if (requestId !== predictionRequestIdRef.current) return;
      setPersonalDataset(records);
      setContributionSavedFor({ id: photo.id, expression });
      setContributionConsent(false);
    } catch (saveError) {
      if (requestId === predictionRequestIdRef.current) {
        setContributionError(saveError instanceof Error ? saveError.message : 'Could not save this photo locally.');
      }
    } finally {
      if (requestId === predictionRequestIdRef.current) setContributionSaving(false);
    }
  }

  async function handleDeletePersonalContribution(id: string) {
    try {
      await deletePersonalDatasetContribution(id);
      setPersonalDataset(await listPersonalDatasetContributions());
      setContributionSavedFor((saved) => saved?.id === id ? null : saved);
      setPersonalDatasetError(null);
    } catch (deleteError) {
      setPersonalDatasetError(deleteError instanceof Error ? deleteError.message : 'Could not delete this contribution.');
    }
  }

  async function handleClearPersonalDataset() {
    if (!window.confirm('Delete every locally stored photo in this browser profile? This cannot be undone.')) return;
    try {
      await clearPersonalDataset();
      setPersonalDataset([]);
      setContributionSavedFor(null);
      setPersonalDatasetError(null);
    } catch (clearError) {
      setPersonalDatasetError(clearError instanceof Error ? clearError.message : 'Could not clear this personal dataset.');
    }
  }

  const playlistChoices = getPlaylistChoices(expression || null);
  const expressionName = expression ? `${expression[0].toUpperCase()}${expression.slice(1)}` : '';
  const moodHeading = expression
    ? expression === prediction?.expression
      ? `Your visible expression seems ${expressionName}`
      : `You selected ${expressionName}`
    : 'Choose a playlist for your vibe';

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand-link" href="#home" aria-label="Moodify home">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>Moodify</span>
        </a>
        <nav className="primary-nav" aria-label="Main navigation">
          <a href="#home" aria-current={activePage === 'home' ? 'page' : undefined}>Discover</a>
          <a href="#playlists" aria-current={activePage === 'playlists' ? 'page' : undefined}>Playlist ideas</a>
          <a href="#personal-dataset" aria-current={activePage === 'dataset' ? 'page' : undefined}>My dataset</a>
        </nav>
        <a className="header-cta" href="#playlists" onClick={stopCamera}>Create playlist</a>
        <div className={`status-pill ${apiStatus === 'ok' ? 'online' : ''}`} aria-label={`API status: ${apiStatus}`}>
          <span className="status-indicator" aria-hidden="true" />
          API {apiStatus}
        </div>
      </header>

      <main>
      {activePage === 'home' ? (
        <>
      <section className="hero-card">
        <div>
          <p className="eyebrow">Expression-aware music discovery</p>
          <h1>Find your next mood.</h1>
          <p className="hero-copy">
            Visible expression can spark playlist ideas—not reveal how you feel.
          </p>
        </div>
        <div className="quick-actions" aria-label="Mood and photo controls">
          <section className="emotion-prediction" aria-labelledby="emotion-prediction-title" ref={predictionSectionRef}>
            <p className="eyebrow" id="emotion-prediction-title">Emotion prediction</p>
            {prediction ? (
              <div className="prediction-card" role="status" aria-live="polite">
                <strong>Visible-expression estimate: {prediction.status.replaceAll('_', ' ')}</strong>
                <span>
                  Detected expression: {prediction.expression ?? 'not available'} | Confidence:{' '}
                  {Math.round(prediction.confidence * 100)}%
                </span>
                <small>Model: {prediction.model_version}</small>
              </div>
            ) : predicting ? (
              <div className="prediction-card" role="status" aria-live="polite">
                <strong>Analyzing your photo…</strong>
                <span>Your estimate will appear here.</span>
              </div>
            ) : (
              <div className="prediction-card prediction-placeholder" role="status" aria-live="polite">
                <strong>Your expression estimate will appear here</strong>
                <span>Capture or upload a photo to get started.</span>
              </div>
            )}
            <div className="prediction-actions">
              <button type="button" onClick={showPlaylistChoices} disabled={predicting}>
                Show Playlist
              </button>
              <button type="button" className="secondary-action" onClick={clearPrediction}>
                Clear
              </button>
            </div>
            {prediction ? (
              <div className="correction-control">
                <label htmlFor="expression-correction">
                  {prediction.expression ? 'Correct detected expression' : 'Choose an expression (optional)'}
                  <select
                    id="expression-correction"
                    value={expression}
                    onChange={handleExpressionCorrection}
                    disabled={predicting}
                  >
                    {expressionOptions.map((option) => (
                      <option key={option.label} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <small>
                  {expression
                    ? `Selected mood: ${expressionName}. This does not change the model estimate.`
                    : 'No mood selected. You can browse general playlist styles.'}
                </small>
              </div>
            ) : null}
            {prediction?.expression && expression && expression !== prediction.expression && currentPhotoRef.current ? (
              <div className="contribution-consent">
                {contributionSavedFor?.id === currentPhotoRef.current.id ? (
                  <p role="status">
                    Saved locally with your label “{contributionSavedFor.expression}”. This photo is not uploaded for
                    training; personal model training is not implemented yet.
                  </p>
                ) : (
                  <>
                    <label className="consent-checkbox">
                      <input
                        type="checkbox"
                        checked={contributionConsent}
                        onChange={(event) => setContributionConsent(event.target.checked)}
                        disabled={contributionSaving}
                      />
                      I consent to save this photo and my corrected expression label in this browser’s personal dataset.
                      It will not be shared for training or change the shared model.
                    </label>
                    <small>
                      This stays in this browser profile and is not encrypted. The inference upload is not retained by
                      the backend. You can delete saved photos on <a href="#personal-dataset">My dataset</a>.
                    </small>
                    <button
                      type="button"
                      onClick={handleSavePersonalContribution}
                      disabled={!contributionConsent || contributionSaving || predicting}
                    >
                      {contributionSaving ? 'Saving locally…' : 'Save photo for my personal dataset'}
                    </button>
                  </>
                )}
                {contributionError ? <p className="camera-error" role="alert">{contributionError}</p> : null}
              </div>
            ) : null}
          </section>
          <div className="capture-controls">
            <p className="eyebrow">Photo capture</p>
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
              <button type="button" onClick={capturePhoto} disabled={!cameraActive || predicting}>
                {predicting ? 'Analyzing photo...' : 'Click photo'}
              </button>
              <label className="file-picker">
                Upload image
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileSelected}
                  disabled={predicting}
                />
              </label>
            </div>
          </div>
          {cameraError ? <p className="camera-error" role="alert">{cameraError}</p> : null}
        </div>
      </section>

        </>
      ) : activePage === 'dataset' ? (
        <section className="dataset-page" aria-labelledby="personal-dataset-title">
          <div className="dataset-page-heading">
            <p className="eyebrow">Private to this browser profile</p>
            <h1 id="personal-dataset-title">My personal dataset</h1>
            <p>Review and manage the photos you explicitly chose to save on this device.</p>
          </div>
          <section className="panel personal-dataset-panel" aria-label="Saved photos">
        <div className="results-heading">
          <h2>Saved photos</h2>
          <p>
            {personalDataset.length} opted-in photo{personalDataset.length === 1 ? '' : 's'} saved locally. None is sent
            to Moodify’s server or shared/global training. Personal model training is not implemented yet.
          </p>
        </div>
        {personalDatasetError ? <p className="error" role="alert">{personalDatasetError}</p> : null}
        {personalDataset.length > 0 ? (
          <>
            <ul className="personal-dataset-list">
              {personalDataset.map((record) => (
                <li key={record.id}>
                  <span>
                    {record.expression} · saved {new Date(record.createdAt).toLocaleString()}
                  </span>
                  <button type="button" onClick={() => void handleDeletePersonalContribution(record.id)}>
                    Delete photo
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="danger-button" onClick={() => void handleClearPersonalDataset()}>
              Delete all personal photos
            </button>
          </>
        ) : (
          <div className="empty-dataset-state">
            <p className="empty-state">No photos are saved. Contributions require consent for each photo.</p>
            <a href="#home">Go to Discover to add a photo</a>
          </div>
        )}
          </section>
          <aside className="privacy-note">
            <span className="privacy-icon" aria-hidden="true">🔒</span>
            <div>
              <h2>Your photos stay in this browser</h2>
              <p>Saved items are stored locally and are not used for shared training. Anyone with access to this browser profile may be able to view them. You can remove one photo or clear the entire dataset here.</p>
            </div>
          </aside>
        </section>
      ) : (
        <section className="playlist-page" aria-labelledby="playlist-heading">
          <div className="dataset-page-heading">
            <p className="eyebrow">Playlist ideas</p>
            <h1 id="playlist-heading">{moodHeading}</h1>
            <p>
              {expression
                ? 'Your expression is only a suggestion. Choose the soundtrack that feels right to you.'
                : 'Explore a mix of playlist styles, or go back to Discover to choose a mood.'}
            </p>
          </div>
          <section className="panel results-panel" aria-label="Recommended playlists">
            <ul className="playlist-choice-list">
              {playlistChoices.map((choice) => (
                <li key={choice.label}>
                  <a
                    className="playlist-choice"
                    href={getYouTubePlaylistSearchUrl(choice.searchQuery)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>
                      <strong>{choice.label}</strong>
                      <small>{choice.description}</small>
                    </span>
                    <span className="playlist-choice-arrow" aria-hidden="true">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <a className="back-to-discover" href="#home">← Back to Discover</a>
        </section>
      )}
      </main>
      <footer className="site-footer">Moodify · Choose what feels right for you.</footer>
    </div>
  );
}

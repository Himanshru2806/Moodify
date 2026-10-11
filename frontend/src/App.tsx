import { ChangeEvent, useEffect, useRef, useState } from 'react';

import { getHealth, predictExpression } from './services/api';
import {
  createCatalogueTrack,
  deleteCatalogueTrack,
  deleteManagedUser,
  getAdminAudit,
  getAdminMetrics,
  getAdminOperationalStatus,
  getRecommendationWeights,
  listAdminCatalogue,
  listAdminUsers,
  saveRecommendationWeights,
  setUserRole,
  setUserSuspension,
  updateCatalogueTrack,
} from './services/admin';
import type { AdminAuditRecord, AdminMetrics, AdminOperationalStatus, AdminTrack, AdminUser, AccountRole, RecommendationWeights } from './services/admin';
import {
  clearPersonalDataset,
  createContributionId,
  deletePersonalDatasetContribution,
  listPersonalDatasetContributions,
  savePersonalDatasetContribution,
} from './services/personalDataset';
import { getPlaylistChoices } from './services/playlistOptions';
import { getYouTubePlaylistSearchUrl, getYouTubeSongSearchUrl } from './services/streaming';
import {
  createPersonalSong,
  deletePersonalSong,
  listPersonalSongs,
  loginAccount,
  logoutAccount,
  refreshSession,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  updateAccountProfile,
  verifyAccount,
} from './services/personalPlaylists';
import type { PersonalSong, SessionUser } from './services/personalPlaylists';
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

type AppPage = 'home' | 'dataset' | 'playlists' | 'create' | 'account' | 'admin' | 'verify' | 'reset';
type AccountMode = 'signin' | 'signup' | 'forgot';

function routeParts(hash = window.location.hash): { page: AppPage; mood: ExpressionLabel | '' } {
  const [route, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const moodParam = params.get('mood') ?? '';
  const mood = expressionOptions.some((option) => option.value === moodParam)
    ? moodParam as ExpressionLabel | ''
    : '';
  const page: AppPage = route === 'personal-dataset' ? 'dataset'
    : route === 'playlists' ? 'playlists'
      : route === 'create-playlist' ? 'create'
        : route === 'account' ? 'account'
          : route === 'admin' ? 'admin'
            : route === 'verify' ? 'verify'
            : route === 'reset-password' ? 'reset'
              : 'home';
  return { page, mood };
}

function hashParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

export function App() {
  const [activePage, setActivePage] = useState<AppPage>(() => routeParts().page);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const predictionSectionRef = useRef<HTMLElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const currentPhotoRef = useRef<{ id: string; image: Blob; filename: string } | null>(null);
  const predictionRequestIdRef = useRef(0);
  const [apiStatus, setApiStatus] = useState('checking');
  const [expression, setExpression] = useState<ExpressionLabel | ''>(() => routeParts().mood);
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
  const [session, setSession] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountMode, setAccountMode] = useState<AccountMode>('signin');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountDisplayName, setAccountDisplayName] = useState('');
  const [accountUsername, setAccountUsername] = useState('');
  const [showAccountPassword, setShowAccountPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [songTitle, setSongTitle] = useState('');
  const [songMood, setSongMood] = useState<ExpressionLabel | ''>(() => routeParts().mood);
  const [personalSongs, setPersonalSongs] = useState<PersonalSong[]>([]);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminMetrics, setAdminMetrics] = useState<AdminMetrics | null>(null);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [adminCatalogue, setAdminCatalogue] = useState<AdminTrack[]>([]);
  const [adminAudit, setAdminAudit] = useState<AdminAuditRecord[]>([]);
  const [operationalStatus, setOperationalStatus] = useState<AdminOperationalStatus | null>(null);
  const [recommendationWeights, setRecommendationWeights] = useState<RecommendationWeights | null>(null);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [trackDraft, setTrackDraft] = useState({ id: '', title: '', artist: '', language: '', genre: '', energy: '0.5', tags: '', source_url: '' });

  useEffect(() => {
    function updatePageFromHash() {
      const route = routeParts();
      setActivePage(route.page);
      if (route.mood) {
        setExpression(route.mood);
        setSongMood(route.mood);
      }
    }

    window.addEventListener('hashchange', updatePageFromHash);
    return () => window.removeEventListener('hashchange', updatePageFromHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshSession()
      .then((user) => { if (!cancelled) setSession(user); })
      .catch(() => { if (!cancelled) setSession(null); })
      .finally(() => { if (!cancelled) setAuthLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!session) {
      setPersonalSongs([]);
      return;
    }
    let cancelled = false;
    void listPersonalSongs(session.access_token)
      .then((songs) => { if (!cancelled) setPersonalSongs(songs); })
      .catch((loadError: unknown) => {
        if (!cancelled) setPlaylistError(loadError instanceof Error ? loadError.message : 'Could not load your songs.');
      });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (activePage !== 'admin' || !session || !['admin', 'super_user'].includes(session.role ?? 'user')) return;
    void loadAdminDashboard();
  }, [activePage, session]);

  useEffect(() => {
    if (activePage !== 'verify') return;
    const token = hashParams().get('token');
    if (!token) {
      setActionMessage('This verification link is missing its token.');
      return;
    }
    let cancelled = false;
    void verifyAccount(token)
      .then((result) => { if (!cancelled) setActionMessage(result.message); })
      .catch((error: unknown) => { if (!cancelled) setActionMessage(error instanceof Error ? error.message : 'Could not verify this account.'); });
    return () => { cancelled = true; };
  }, [activePage]);

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
    window.location.hash = expression ? `#playlists?mood=${expression}` : '#playlists';
  }

  async function handleAccountSubmit(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    setAuthMessage(null);
    try {
      if (accountMode === 'signup') {
        const result = await registerAccount(accountEmail, accountPassword, accountDisplayName, accountUsername);
        setAuthMessage(result.message);
        setAccountPassword('');
        setShowAccountPassword(false);
        setAccountMode('signin');
      } else if (accountMode === 'forgot') {
        const result = await requestPasswordReset(accountEmail);
        setAuthMessage(result.message);
      } else {
        const user = await loginAccount(accountEmail, accountPassword);
        setSession(user);
        const params = hashParams();
        const next = params.get('next');
        const nextMood = params.get('mood');
        window.location.hash = next === 'create-playlist'
          ? `#create-playlist${nextMood ? `?mood=${encodeURIComponent(nextMood)}` : ''}`
          : next === 'playlists'
            ? `#playlists${nextMood ? `?mood=${encodeURIComponent(nextMood)}` : ''}`
            : '#home';
      }
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Could not complete this account request.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleResetPassword(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = hashParams().get('token');
    if (!token) {
      setAuthError('This reset link is missing its token.');
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await resetPassword(token, newPassword);
      setActionMessage(result.message);
      window.location.hash = '#account';
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Could not update your password.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    let logoutFailed = false;
    try {
      await logoutAccount();
    } catch (error: unknown) {
      logoutFailed = true;
      setAuthError(error instanceof Error ? `Signed out locally, but the server could not revoke the session: ${error.message}` : 'Signed out locally, but the server could not revoke the session.');
    } finally {
      setSession(null);
      setPersonalSongs([]);
      setProfileEditing(false);
      window.location.hash = logoutFailed ? '#account' : '#home';
    }
  }

  async function handleProfileSubmit(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setProfileBusy(true);
    setAuthError(null);
    setAuthMessage(null);
    try {
      const profile = await updateAccountProfile(session.access_token, accountDisplayName, accountUsername);
      setSession({ ...session, ...profile });
      setAccountDisplayName(profile.display_name);
      setAccountUsername(profile.username);
      setProfileEditing(false);
      setAuthMessage('Your profile was updated.');
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Could not update your profile.');
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleAddPersonalSong(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !songMood || !songTitle.trim()) return;
    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      const song = await createPersonalSong(session.access_token, songMood, songTitle.trim());
      setPersonalSongs((songs) => [...songs, song]);
      setSongTitle('');
    } catch (error: unknown) {
      setPlaylistError(error instanceof Error ? error.message : 'Could not save this song.');
    } finally {
      setPlaylistBusy(false);
    }
  }

  async function handleDeletePersonalSong(id: string) {
    if (!session) return;
    setPlaylistError(null);
    try {
      await deletePersonalSong(session.access_token, id);
      setPersonalSongs((songs) => songs.filter((song) => song.id !== id));
    } catch (error: unknown) {
      setPlaylistError(error instanceof Error ? error.message : 'Could not delete this song.');
    }
  }

  async function loadAdminDashboard(query = adminSearch) {
    if (!session) return;
    setAdminBusy(true);
    setAdminError(null);
    try {
      const [users, metrics, status] = await Promise.all([
        listAdminUsers(session.access_token, query),
        getAdminMetrics(session.access_token),
        getAdminOperationalStatus(session.access_token),
      ]);
      setAdminUsers(users);
      setAdminMetrics(metrics);
      setOperationalStatus(status);
      if (session.role === 'super_user') {
        const [catalogue, weights, audit] = await Promise.all([
          listAdminCatalogue(session.access_token),
          getRecommendationWeights(session.access_token),
          getAdminAudit(session.access_token),
        ]);
        setAdminCatalogue(catalogue);
        setRecommendationWeights(weights);
        setAdminAudit(audit);
      }
    } catch (error: unknown) {
      setAdminError(error instanceof Error ? error.message : 'Could not load the admin dashboard.');
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleAdminSuspension(user: AdminUser) {
    if (!session) return;
    const suspended = !user.is_suspended;
    if (!window.confirm(`${suspended ? 'Suspend' : 'Restore'} ${user.email}?${suspended ? ' Their current sessions will be revoked.' : ''}`)) return;
    setAdminError(null);
    setAdminMessage(null);
    try {
      await setUserSuspension(session.access_token, user.id, suspended);
      setAdminMessage(`${user.email} was ${suspended ? 'suspended' : 'restored'}.`);
      await loadAdminDashboard();
    } catch (error: unknown) {
      setAdminError(error instanceof Error ? error.message : 'Could not update this account.');
    }
  }

  async function handleAdminRoleChange(user: AdminUser, role: AccountRole) {
    if (!session || role === user.role) return;
    if (!window.confirm(`Change ${user.email} from ${user.role.replace('_', ' ')} to ${role.replace('_', ' ')}?`)) return;
    setAdminError(null);
    setAdminMessage(null);
    try {
      await setUserRole(session.access_token, user.id, role);
      setAdminMessage(`Role updated for ${user.email}.`);
      await loadAdminDashboard();
    } catch (error: unknown) {
      setAdminError(error instanceof Error ? error.message : 'Could not change this account role.');
    }
  }

  async function handleAdminDelete(user: AdminUser) {
    if (!session || !window.confirm(`Permanently delete ${user.email} and all their personal playlist data? This cannot be undone.`)) return;
    setAdminError(null);
    setAdminMessage(null);
    try {
      await deleteManagedUser(session.access_token, user.id);
      setAdminMessage(`Deleted ${user.email} and associated playlist data.`);
      await loadAdminDashboard();
    } catch (error: unknown) {
      setAdminError(error instanceof Error ? error.message : 'Could not delete this account.');
    }
  }

  async function handleCatalogueSubmit(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setAdminError(null);
    setAdminMessage(null);
    const track: AdminTrack = {
      id: trackDraft.id.trim(),
      title: trackDraft.title.trim(),
      artist: trackDraft.artist.trim(),
      language: trackDraft.language.trim(),
      genre: trackDraft.genre.trim(),
      energy: Number(trackDraft.energy),
      tags: trackDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      expression_affinities: {},
      source_url: trackDraft.source_url.trim() || null,
    };
    try {
      if (editingTrackId) {
        await updateCatalogueTrack(session.access_token, track);
        setAdminMessage(`Updated catalogue track “${track.title}”.`);
      } else {
        await createCatalogueTrack(session.access_token, track);
        setAdminMessage(`Added catalogue track “${track.title}”.`);
      }
      setEditingTrackId(null);
      setTrackDraft({ id: '', title: '', artist: '', language: '', genre: '', energy: '0.5', tags: '', source_url: '' });
      await loadAdminDashboard();
    } catch (error: unknown) {
      setAdminError(error instanceof Error ? error.message : 'Could not save this catalogue track.');
    }
  }

  function beginTrackEdit(track: AdminTrack) {
    setEditingTrackId(track.id);
    setTrackDraft({
      id: track.id,
      title: track.title,
      artist: track.artist,
      language: track.language,
      genre: track.genre,
      energy: String(track.energy),
      tags: track.tags.join(', '),
      source_url: track.source_url ?? '',
    });
  }

  async function handleCatalogueDelete(track: AdminTrack) {
    if (!session || !window.confirm(`Delete “${track.title}” from the recommendation catalogue?`)) return;
    setAdminError(null);
    setAdminMessage(null);
    try {
      await deleteCatalogueTrack(session.access_token, track.id);
      setAdminMessage(`Deleted “${track.title}”.`);
      await loadAdminDashboard();
    } catch (error: unknown) {
      setAdminError(error instanceof Error ? error.message : 'Could not delete this catalogue track.');
    }
  }

  async function handleRecommendationWeightsSubmit(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !recommendationWeights) return;
    setAdminError(null);
    setAdminMessage(null);
    try {
      const updated = await saveRecommendationWeights(session.access_token, recommendationWeights);
      setRecommendationWeights(updated);
      setAdminMessage('Recommendation scoring weights saved.');
    } catch (error: unknown) {
      setAdminError(error instanceof Error ? error.message : 'Could not save recommendation settings.');
    }
  }

  function clearPrediction() {
    predictionRequestIdRef.current += 1;
    currentPhotoRef.current = null;
    setPrediction(null);
    setExpression('');
    setSongMood('');
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
    setSongMood(correctedExpression);
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
  const moodPersonalSongs = expression ? personalSongs.filter((song) => song.mood === expression) : [];
  const creatorPersonalSongs = songMood ? personalSongs.filter((song) => song.mood === songMood) : [];
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
          <a href={expression ? `#playlists?mood=${expression}` : '#playlists'} aria-current={activePage === 'playlists' ? 'page' : undefined}>Playlist ideas</a>
          <a href="#personal-dataset" aria-current={activePage === 'dataset' ? 'page' : undefined}>My dataset</a>
          <a href="#account" aria-current={activePage === 'account' ? 'page' : undefined}>{session ? 'My account' : 'Sign in'}</a>
          {session && ['admin', 'super_user'].includes(session.role ?? 'user') ? <a href="#admin" aria-current={activePage === 'admin' ? 'page' : undefined}>Admin</a> : null}
          {session ? <button type="button" className="header-signout" onClick={() => void handleLogout()}>Sign out</button> : null}
        </nav>
        <a
          className="header-cta"
          href={`#create-playlist${expression ? `?mood=${expression}` : ''}`}
          onClick={stopCamera}
        >Create playlist</a>
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
      ) : activePage === 'create' ? (
        <section className="playlist-page" aria-labelledby="create-personal-playlist-title">
          <div className="dataset-page-heading">
            <p className="eyebrow">Your music, organized by mood</p>
            <h1 id="create-personal-playlist-title">Create your playlist</h1>
            <p>Add song titles to a mood. Moodify creates a YouTube search link; it may not identify the exact recording.</p>
          </div>
          {authLoading ? <p role="status">Checking your account…</p> : !session ? (
            <section className="panel personal-playlist-panel">
              <h2>Sign in to save and sync songs</h2>
              <p>Your playlist will be available when you sign in on another device.</p>
              <a className="back-to-discover" href={`#account?next=create-playlist${songMood ? `&mood=${songMood}` : ''}`}>
                Sign in or create an account
              </a>
            </section>
          ) : (
            <section className="panel personal-playlist-panel" aria-label="Personal playlist editor">
              <form className="personal-song-form" onSubmit={handleAddPersonalSong}>
                <label htmlFor="personal-song-mood">Mood
                  <select
                    id="personal-song-mood"
                    value={songMood}
                    onChange={(event) => setSongMood(event.target.value as ExpressionLabel | '')}
                    required
                  >
                    <option value="" disabled>Choose a mood</option>
                    {expressionOptions.filter((option) => option.value).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label htmlFor="personal-song-title">Song title
                  <input
                    id="personal-song-title"
                    value={songTitle}
                    onChange={(event) => setSongTitle(event.target.value)}
                    maxLength={200}
                    placeholder="e.g. Here Comes the Sun"
                    required
                  />
                </label>
                <button type="submit" disabled={playlistBusy || !songMood || !songTitle.trim()}>
                  {playlistBusy ? 'Saving…' : 'Add song'}
                </button>
              </form>
              {playlistError ? <p className="error" role="alert">{playlistError}</p> : null}
              <div className="results-heading personal-songs-heading">
                <h2>{songMood ? `${songMood[0].toUpperCase()}${songMood.slice(1)} songs` : 'Choose a mood to get started'}</h2>
                <p>{creatorPersonalSongs.length} song{creatorPersonalSongs.length === 1 ? '' : 's'} saved for this mood.</p>
              </div>
              {creatorPersonalSongs.length ? (
                <ul className="personal-song-list">
                  {creatorPersonalSongs.map((song) => (
                    <li key={song.id}>
                      <a href={getYouTubeSongSearchUrl(song.title)} target="_blank" rel="noopener noreferrer">
                        <strong>{song.title}</strong><small>Search YouTube ↗</small>
                      </a>
                      <button type="button" className="song-delete-button" onClick={() => void handleDeletePersonalSong(song.id)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="empty-state">No songs added to this mood yet.</p>}
              {songMood ? <a className="back-to-discover" href={`#playlists?mood=${songMood}`}>View {songMood} playlist ideas →</a> : null}
            </section>
          )}
          <a className="back-to-discover" href="#home">← Back to Discover</a>
        </section>
      ) : activePage === 'account' ? (
        <section className="dataset-page" aria-labelledby="account-title">
          <div className="dataset-page-heading">
            <p className="eyebrow">Personal playlists sync with your account</p>
            <h1 id="account-title">{session ? 'Your Moodify account' : accountMode === 'signup' ? 'Create your account' : accountMode === 'forgot' ? 'Reset your password' : 'Welcome back'}</h1>
            <p>{session ? `Signed in as ${session.display_name} (@${session.username})` : 'Sign in to manage your personal mood playlists across devices.'}</p>
          </div>
          {session ? (
            <section className="panel personal-playlist-panel">
              <h2>{session.display_name} <span className="account-username">@{session.username}</span></h2>
              <p>{session.email}</p>
              <p>{personalSongs.length} personal song{personalSongs.length === 1 ? '' : 's'} saved across your moods.</p>
              {!profileEditing ? (
                <button type="button" onClick={() => {
                  setAccountDisplayName(session.display_name);
                  setAccountUsername(session.username);
                  setProfileEditing(true);
                  setAuthError(null);
                  setAuthMessage(null);
                }}>Edit profile</button>
              ) : (
                <form className="account-form" onSubmit={(event) => void handleProfileSubmit(event)}>
                  <label htmlFor="profile-display-name">Display name
                    <input id="profile-display-name" value={accountDisplayName} onChange={(event) => setAccountDisplayName(event.target.value)} maxLength={80} required />
                  </label>
                  <label htmlFor="profile-username">Username
                    <input id="profile-username" value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} minLength={3} maxLength={30} pattern="[A-Za-z0-9_]{3,30}" autoComplete="username" required />
                    <small>3–30 letters, numbers, or underscores.</small>
                  </label>
                  {authError ? <p className="error" role="alert">{authError}</p> : null}
                  {authMessage ? <p role="status">{authMessage}</p> : null}
                  <div className="profile-form-actions">
                    <button type="submit" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save profile'}</button>
                    <button type="button" className="secondary-button" onClick={() => setProfileEditing(false)}>Cancel</button>
                  </div>
                </form>
              )}
            </section>
          ) : (
            <section className="panel personal-playlist-panel">
              <form className="account-form" onSubmit={(event) => void handleAccountSubmit(event)}>
                <label htmlFor="account-email">Email
                  <input id="account-email" type="email" autoComplete="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} required />
                </label>
                {accountMode === 'signup' ? (
                  <>
                    <label htmlFor="account-display-name">Display name
                      <input id="account-display-name" value={accountDisplayName} onChange={(event) => setAccountDisplayName(event.target.value)} maxLength={80} autoComplete="name" required />
                    </label>
                    <label htmlFor="account-username">Username
                      <input id="account-username" value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} minLength={3} maxLength={30} pattern="[A-Za-z0-9_]{3,30}" autoComplete="username" required />
                      <small>3–30 letters, numbers, or underscores.</small>
                    </label>
                  </>
                ) : null}
                {accountMode !== 'forgot' ? (
                  <label htmlFor="account-password">Password
                    <div className="password-input-wrap">
                      <input id="account-password" type={showAccountPassword ? 'text' : 'password'} autoComplete={accountMode === 'signup' ? 'new-password' : 'current-password'} minLength={12} maxLength={128} value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} required />
                      <button type="button" className="password-visibility-toggle" aria-label={showAccountPassword ? 'Hide password' : 'Show password'} aria-pressed={showAccountPassword} onClick={() => setShowAccountPassword(!showAccountPassword)}>{showAccountPassword ? 'Hide' : 'Show'}</button>
                    </div>
                    <small>Use at least 12 characters.</small>
                  </label>
                ) : null}
                {authError ? <p className="error" role="alert">{authError}</p> : null}
                {authMessage ? <p role="status">{authMessage}</p> : null}
                {actionMessage ? <p role="status">{actionMessage}</p> : null}
                <button type="submit" disabled={authBusy}>
                  {authBusy ? 'Please wait…' : accountMode === 'signup' ? 'Create account' : accountMode === 'forgot' ? 'Send reset link' : 'Sign in'}
                </button>
              </form>
              <div className="account-mode-links">
                <button type="button" className="text-button" onClick={() => { setAccountMode(accountMode === 'signup' ? 'signin' : 'signup'); setShowAccountPassword(false); setAuthError(null); setAuthMessage(null); }}>
                  {accountMode === 'signup' ? 'Already have an account? Sign in' : 'New to Moodify? Create an account'}
                </button>
                {accountMode !== 'signup' ? (
                  <button type="button" className="text-button" onClick={() => { setAccountMode(accountMode === 'forgot' ? 'signin' : 'forgot'); setAuthError(null); setAuthMessage(null); }}>
                    {accountMode === 'forgot' ? 'Back to sign in' : 'Forgot password?'}
                  </button>
                ) : null}
              </div>
            </section>
          )}
        </section>
      ) : activePage === 'admin' ? (
        <section className="dataset-page admin-page" aria-labelledby="admin-title">
          <div className="dataset-page-heading">
            <p className="eyebrow">Product operations · {session?.role?.replace('_', ' ') ?? 'account'}</p>
            <h1 id="admin-title">Moodify administration</h1>
            <p>Manage accounts and review aggregate usage. Account deletion permanently removes associated personal playlists.</p>
          </div>
          {authLoading ? <p role="status">Checking your account…</p> : !session ? (
            <section className="panel"><h2>Sign in required</h2><a href="#account">Sign in to continue</a></section>
          ) : !['admin', 'super_user'].includes(session.role ?? 'user') ? (
            <section className="panel"><h2>Admin access required</h2><p>This account does not have admin privileges.</p><a href="#home">Return to Discover</a></section>
          ) : (
            <>
              {adminMetrics ? <div className="admin-metrics" aria-label="Product metrics">
                <article><span>Total accounts</span><strong>{adminMetrics.users_total}</strong></article>
                <article><span>Verified accounts</span><strong>{adminMetrics.users_verified}</strong></article>
                <article><span>Suspended accounts</span><strong>{adminMetrics.users_suspended}</strong></article>
                <article><span>Personal songs</span><strong>{adminMetrics.songs_total}</strong></article>
              </div> : null}
              <section className="panel admin-users-panel" aria-label="User management">
                <div className="admin-toolbar">
                  <div><h2>User management</h2><p>Search by email, name, or username.</p></div>
                  <form className="admin-search" onSubmit={(event) => { event.preventDefault(); void loadAdminDashboard(); }}>
                    <label className="visually-hidden" htmlFor="admin-user-search">Search users</label>
                    <input id="admin-user-search" value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} placeholder="Search accounts" />
                    <button type="submit" disabled={adminBusy}>{adminBusy ? 'Loading…' : 'Search'}</button>
                  </form>
                </div>
                {adminError ? <p className="error" role="alert">{adminError}</p> : null}
                {adminMessage ? <p role="status">{adminMessage}</p> : null}
                {adminUsers.length ? <div className="admin-table-wrap"><table className="admin-user-table">
                  <thead><tr><th>Account</th><th>Status</th><th>Role</th><th>Actions</th></tr></thead>
                  <tbody>{adminUsers.map((user) => <tr key={user.id}>
                    <td><strong>{user.display_name}</strong><small>{user.email} · @{user.username}</small></td>
                    <td>{user.is_suspended ? 'Suspended' : user.is_verified ? 'Verified' : 'Unverified'}</td>
                    <td>{session.role === 'super_user' && user.email !== session.email ? <select aria-label={`Role for ${user.email}`} value={user.role} onChange={(event) => void handleAdminRoleChange(user, event.target.value as AccountRole)}>
                      <option value="user">User</option><option value="admin">Admin</option><option value="super_user">Super user</option>
                    </select> : user.role.replace('_', ' ')}</td>
                    <td className="admin-row-actions">
                      <button type="button" className="secondary-button" disabled={user.email === session.email || (session.role === 'admin' && user.role !== 'user')} onClick={() => void handleAdminSuspension(user)}>{user.is_suspended ? 'Restore' : 'Suspend'}</button>
                      <button type="button" className="danger-button" disabled={user.email === session.email || (session.role === 'admin' && user.role !== 'user')} onClick={() => void handleAdminDelete(user)}>Delete</button>
                    </td>
                  </tr>)}</tbody>
                </table></div> : <p className="empty-state">{adminBusy ? 'Loading accounts…' : 'No matching accounts.'}</p>}
              </section>
              {operationalStatus ? <section className="panel admin-status-panel" aria-label="Service status">
                <h2>Service status</h2>
                <p>API: <strong>{operationalStatus.status}</strong> · Database: <strong>{operationalStatus.database}</strong></p>
                <small>Environment: {operationalStatus.environment} · API version: {operationalStatus.api_version}. Secret values are not exposed here.</small>
              </section> : null}
              {session.role === 'super_user' ? <>
                <section className="panel admin-catalogue-panel" aria-label="Recommendation catalogue">
                  <div className="admin-toolbar"><div><h2>Recommendation catalogue</h2><p>Changes immediately affect recommendation results.</p></div></div>
                  <form className="admin-catalogue-form" onSubmit={(event) => void handleCatalogueSubmit(event)}>
                    <label>Track ID<input value={trackDraft.id} onChange={(event) => setTrackDraft({ ...trackDraft, id: event.target.value })} maxLength={80} required disabled={Boolean(editingTrackId)} /></label>
                    <label>Title<input value={trackDraft.title} onChange={(event) => setTrackDraft({ ...trackDraft, title: event.target.value })} maxLength={200} required /></label>
                    <label>Artist<input value={trackDraft.artist} onChange={(event) => setTrackDraft({ ...trackDraft, artist: event.target.value })} maxLength={200} required /></label>
                    <label>Language<input value={trackDraft.language} onChange={(event) => setTrackDraft({ ...trackDraft, language: event.target.value })} maxLength={80} required /></label>
                    <label>Genre<input value={trackDraft.genre} onChange={(event) => setTrackDraft({ ...trackDraft, genre: event.target.value })} maxLength={80} required /></label>
                    <label>Energy (0–1)<input type="number" value={trackDraft.energy} onChange={(event) => setTrackDraft({ ...trackDraft, energy: event.target.value })} min="0" max="1" step="0.01" required /></label>
                    <label>Tags, comma separated<input value={trackDraft.tags} onChange={(event) => setTrackDraft({ ...trackDraft, tags: event.target.value })} placeholder="calm, focus" /></label>
                    <label>Source URL (optional)<input type="url" value={trackDraft.source_url} onChange={(event) => setTrackDraft({ ...trackDraft, source_url: event.target.value })} maxLength={1000} /></label>
                    <div className="admin-form-actions"><button type="submit">{editingTrackId ? 'Save track' : 'Add track'}</button>{editingTrackId ? <button type="button" className="secondary-button" onClick={() => { setEditingTrackId(null); setTrackDraft({ id: '', title: '', artist: '', language: '', genre: '', energy: '0.5', tags: '', source_url: '' }); }}>Cancel edit</button> : null}</div>
                  </form>
                  {adminCatalogue.length ? <div className="admin-table-wrap"><table className="admin-user-table"><thead><tr><th>Track</th><th>Tags</th><th>Energy</th><th>Actions</th></tr></thead>
                    <tbody>{adminCatalogue.map((track) => <tr key={track.id}><td><strong>{track.title}</strong><small>{track.artist} · {track.language} · {track.genre} · {track.id}</small></td><td>{track.tags.join(', ') || '—'}</td><td>{track.energy.toFixed(2)}</td><td className="admin-row-actions"><button type="button" className="secondary-button" onClick={() => beginTrackEdit(track)}>Edit</button><button type="button" className="danger-button" disabled={adminCatalogue.length <= 1} onClick={() => void handleCatalogueDelete(track)}>Delete</button></td></tr>)}</tbody>
                  </table></div> : <p className="empty-state">No catalogue entries are available.</p>}
                </section>
                {recommendationWeights ? <section className="panel admin-settings-panel" aria-label="Recommendation settings">
                  <h2>Recommendation settings</h2><p>Adjust bounded scoring weights. Infrastructure secrets are deployment-managed and unavailable here.</p>
                  <form className="admin-weights-form" onSubmit={(event) => void handleRecommendationWeightsSubmit(event)}>
                    {([
                      ['goal_tag_weight', 'Goal tag'],
                      ['language_match_weight', 'Language match'],
                      ['genre_match_weight', 'Genre match'],
                      ['expression_affinity_weight', 'Expression context'],
                      ['energy_weight', 'Energy'],
                    ] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" max="5" step="0.1" value={recommendationWeights[key]} onChange={(event) => setRecommendationWeights({ ...recommendationWeights, [key]: Number(event.target.value) })} /></label>)}
                    <button type="submit">Save scoring weights</button>
                  </form>
                </section> : null}
                <section className="panel admin-audit-panel" aria-label="Recent admin actions">
                  <h2>Recent admin actions</h2>
                  {adminAudit.length ? <ul>{adminAudit.slice(0, 10).map((entry) => <li key={entry.id}><strong>{entry.action.replaceAll('_', ' ')}</strong> · {entry.details || entry.target_user_id || '—'} · {new Date(entry.created_at).toLocaleString()}</li>)}</ul> : <p className="empty-state">No admin actions recorded yet.</p>}
                </section>
              </> : null}
            </>
          )}
          <a className="back-to-discover" href="#home">← Back to Discover</a>
        </section>
      ) : activePage === 'verify' ? (
        <section className="dataset-page" aria-labelledby="verify-title">
          <div className="dataset-page-heading"><p className="eyebrow">Account security</p><h1 id="verify-title">Verify your email</h1>
            <p role="status">{actionMessage ?? 'Verifying your one-time link…'}</p>
          </div>
          <a className="back-to-discover" href="#account">Continue to sign in →</a>
        </section>
      ) : activePage === 'reset' ? (
        <section className="dataset-page" aria-labelledby="reset-title">
          <div className="dataset-page-heading"><p className="eyebrow">Account security</p><h1 id="reset-title">Choose a new password</h1></div>
          <section className="panel personal-playlist-panel">
            {actionMessage ? <p role="status">{actionMessage}</p> : (
              <form className="account-form" onSubmit={(event) => void handleResetPassword(event)}>
                <label htmlFor="new-password">New password
                  <div className="password-input-wrap">
                    <input id="new-password" type={showNewPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
                    <button type="button" className="password-visibility-toggle" aria-label={showNewPassword ? 'Hide password' : 'Show password'} aria-pressed={showNewPassword} onClick={() => setShowNewPassword(!showNewPassword)}>{showNewPassword ? 'Hide' : 'Show'}</button>
                  </div>
                </label>
                {authError ? <p className="error" role="alert">{authError}</p> : null}
                <button type="submit" disabled={authBusy}>{authBusy ? 'Updating…' : 'Update password'}</button>
              </form>
            )}
          </section>
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
              {moodPersonalSongs.map((song) => (
                <li key={song.id} className="personal-choice-row">
                  <a className="playlist-choice" href={getYouTubeSongSearchUrl(song.title)} target="_blank" rel="noopener noreferrer">
                    <span><strong>{song.title}</strong><small>Your personal {expression} song · Search YouTube</small></span>
                    <span className="playlist-choice-arrow" aria-hidden="true">↗</span>
                  </a>
                  <button type="button" className="song-delete-button" onClick={() => void handleDeletePersonalSong(song.id)} aria-label={`Remove ${song.title} from your playlist`}>Remove</button>
                </li>
              ))}
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
          <a className="back-to-discover" href={`#create-playlist${expression ? `?mood=${expression}` : ''}`}>+ Add your own songs</a>
          <a className="back-to-discover" href="#home">← Back to Discover</a>
        </section>
      )}
      </main>
      <footer className="site-footer">Moodify · Choose what feels right for you.</footer>
    </div>
  );
}

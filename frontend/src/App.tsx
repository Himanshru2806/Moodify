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
import { getYouTubePlaylistSearchUrl, getYouTubeSongSearchUrl, getYouTubeVideoUrl } from './services/streaming';
import {
  createPersonalSong,
  createYouTubePlaylist,
  deletePersonalSong,
  disconnectYouTube,
  findYouTubeMatches,
  getYouTubeConnection,
  listYouTubePlaylists,
  listPersonalSongs,
  loginAccount,
  logoutAccount,
  refreshSession,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  retryYouTubePlaylist,
  selectYouTubeMatch,
  startYouTubeAuthorization,
  updatePersonalSong,
  updateAccountProfile,
  verifyAccount,
} from './services/personalPlaylists';
import type { CreatedYouTubePlaylist, PersonalSong, SessionUser, YouTubeConnectionStatus, YouTubeMatch } from './services/personalPlaylists';
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

function moodPlaylistTitle(mood: ExpressionLabel | ''): string {
  return mood ? `Moodify — ${mood[0].toUpperCase()}${mood.slice(1)}` : 'Moodify playlist';
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
  const [songArtist, setSongArtist] = useState('');
  const [songMood, setSongMood] = useState<ExpressionLabel | ''>(() => routeParts().mood);
  const [personalSongs, setPersonalSongs] = useState<PersonalSong[]>([]);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [youtubeConnection, setYoutubeConnection] = useState<YouTubeConnectionStatus>({ connected: false, google_email: null });
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [youtubeFeedback, setYoutubeFeedback] = useState<string | null>(() => {
    const status = hashParams().get('youtube');
    return status === 'connected' ? 'YouTube account connected.'
      : status ? `YouTube connection was not completed (${status.replaceAll('-', ' ')}).` : null;
  });
  const [youtubeBusy, setYoutubeBusy] = useState(false);
  const [matchBusyId, setMatchBusyId] = useState<string | null>(null);
  const [youtubeMatches, setYoutubeMatches] = useState<Record<string, YouTubeMatch[]>>({});
  const [youtubePlaylistTitle, setYoutubePlaylistTitle] = useState(() => moodPlaylistTitle(routeParts().mood));
  const [createdYoutubePlaylist, setCreatedYoutubePlaylist] = useState<CreatedYouTubePlaylist | null>(null);
  const [createdYoutubePlaylists, setCreatedYoutubePlaylists] = useState<CreatedYouTubePlaylist[]>([]);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [songEditDraft, setSongEditDraft] = useState({ title: '', artist: '' });
  const [songUpdateBusy, setSongUpdateBusy] = useState(false);
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
        setYoutubePlaylistTitle(moodPlaylistTitle(route.mood));
      }
      const youtubeStatus = hashParams().get('youtube');
      if (youtubeStatus) {
        setYoutubeFeedback(youtubeStatus === 'connected'
          ? 'YouTube account connected.'
          : `YouTube connection was not completed (${youtubeStatus.replaceAll('-', ' ')}).`);
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
      setYoutubeConnection({ connected: false, google_email: null });
      return;
    }
    let cancelled = false;
    void listPersonalSongs(session.access_token)
      .then((songs) => { if (!cancelled) setPersonalSongs(songs); })
      .catch((loadError: unknown) => {
        if (!cancelled) setPlaylistError(loadError instanceof Error ? loadError.message : 'Could not load your songs.');
      });
    void getYouTubeConnection(session.access_token)
      .then((connection) => { if (!cancelled) setYoutubeConnection(connection); })
      .catch((loadError: unknown) => {
        if (!cancelled) setYoutubeError(loadError instanceof Error ? loadError.message : 'Could not check YouTube connection.');
      });
    void listYouTubePlaylists(session.access_token)
      .then((playlists) => { if (!cancelled) setCreatedYoutubePlaylists(playlists); })
      .catch((loadError: unknown) => {
        if (!cancelled) setYoutubeError(loadError instanceof Error ? loadError.message : 'Could not load created YouTube playlists.');
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
    if (!session || !songMood || !songTitle.trim() || !songArtist.trim()) return;
    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      const song = await createPersonalSong(session.access_token, songMood, songTitle.trim(), songArtist.trim());
      setPersonalSongs((songs) => [...songs, song]);
      setSongTitle('');
      setSongArtist('');
    } catch (error: unknown) {
      setPlaylistError(error instanceof Error ? error.message : 'Could not save this song.');
    } finally {
      setPlaylistBusy(false);
    }
  }

  async function handleConnectYouTube() {
    if (!session) return;
    setYoutubeBusy(true);
    setYoutubeError(null);
    try {
      const authorizationUrl = await startYouTubeAuthorization(session.access_token, songMood || undefined);
      window.location.assign(authorizationUrl);
    } catch (error: unknown) {
      setYoutubeError(error instanceof Error ? error.message : 'Could not start YouTube authorization.');
      setYoutubeBusy(false);
    }
  }

  async function handleDisconnectYouTube() {
    if (!session) return;
    setYoutubeBusy(true);
    setYoutubeError(null);
    try {
      const disconnected = await disconnectYouTube(session.access_token);
      setYoutubeConnection(disconnected);
      setYoutubeFeedback(disconnected.remote_revoked === false
        ? 'YouTube was disconnected from Moodify, but Google could not confirm remote token revocation. You can revoke access in your Google account settings.'
        : 'YouTube account disconnected and authorization revoked.');
    } catch (error: unknown) {
      setYoutubeError(error instanceof Error ? error.message : 'Could not disconnect YouTube.');
    } finally {
      setYoutubeBusy(false);
    }
  }

  async function handleFindYouTubeMatches(song: PersonalSong) {
    if (!session || !song.artist) {
      setYoutubeError('Add an artist before searching for a YouTube match.');
      return;
    }
    setMatchBusyId(song.id);
    setYoutubeError(null);
    try {
      const matches = await findYouTubeMatches(session.access_token, song.id);
      setYoutubeMatches((current) => ({ ...current, [song.id]: matches }));
      if (!matches.length) setYoutubeFeedback(`No YouTube results found for “${song.title}” by ${song.artist}.`);
    } catch (error: unknown) {
      setYoutubeError(error instanceof Error ? error.message : 'Could not search YouTube for this song.');
    } finally {
      setMatchBusyId(null);
    }
  }

  async function handleChooseYouTubeMatch(songId: string, match: YouTubeMatch) {
    if (!session) return;
    setMatchBusyId(songId);
    setYoutubeError(null);
    try {
      const updatedSong = await selectYouTubeMatch(session.access_token, songId, match.video_id);
      setPersonalSongs((songs) => songs.map((song) => song.id === songId ? updatedSong : song));
      setYoutubeFeedback(`Confirmed “${match.title}” by ${match.channel_title}.`);
    } catch (error: unknown) {
      setYoutubeError(error instanceof Error ? error.message : 'Could not confirm this YouTube match.');
    } finally {
      setMatchBusyId(null);
    }
  }

  async function handleCreateYouTubePlaylist() {
    if (!session || !songMood || !youtubePlaylistTitle.trim()) return;
    setYoutubeBusy(true);
    setYoutubeError(null);
    setCreatedYoutubePlaylist(null);
    try {
      const created = await createYouTubePlaylist(session.access_token, songMood, youtubePlaylistTitle.trim());
      setCreatedYoutubePlaylist(created);
      setCreatedYoutubePlaylists((playlists) => [created, ...playlists]);
      setYoutubeFeedback(created.status === 'created'
        ? `Created a YouTube playlist with ${created.added_count} songs.`
        : `Playlist created with ${created.added_count} songs; some tracks could not be added.`);
    } catch (error: unknown) {
      setYoutubeError(error instanceof Error ? error.message : 'Could not create the YouTube playlist.');
    } finally {
      setYoutubeBusy(false);
    }
  }

  async function handleRetryYouTubePlaylist(playlistId: string) {
    if (!session) return;
    setYoutubeBusy(true);
    setYoutubeError(null);
    try {
      const updated = await retryYouTubePlaylist(session.access_token, playlistId);
      setCreatedYoutubePlaylists((playlists) => playlists.map((playlist) => playlist.id === updated.id ? updated : playlist));
      setCreatedYoutubePlaylist((playlist) => playlist?.id === updated.id ? updated : playlist);
      setYoutubeFeedback(updated.status === 'created'
        ? `All remaining songs were added to “${updated.title}”.`
        : `Retry completed; ${updated.failed_song_ids.length} songs still need to be added.`);
    } catch (error: unknown) {
      setYoutubeError(error instanceof Error ? error.message : 'Could not retry failed YouTube playlist items.');
    } finally {
      setYoutubeBusy(false);
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

  async function handleSongEditSubmit(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !editingSongId || !songEditDraft.title.trim() || !songEditDraft.artist.trim()) return;
    setSongUpdateBusy(true);
    setYoutubeError(null);
    try {
      const updated = await updatePersonalSong(
        session.access_token,
        editingSongId,
        songEditDraft.title.trim(),
        songEditDraft.artist.trim(),
      );
      setPersonalSongs((songs) => songs.map((song) => song.id === updated.id ? updated : song));
      setYoutubeMatches((matches) => ({ ...matches, [updated.id]: [] }));
      setEditingSongId(null);
      setYoutubeFeedback('Song details updated. Search and confirm its YouTube match again.');
    } catch (error: unknown) {
      setYoutubeError(error instanceof Error ? error.message : 'Could not update this song.');
    } finally {
      setSongUpdateBusy(false);
    }
  }

  function beginSongEdit(song: PersonalSong) {
    setEditingSongId(song.id);
    setSongEditDraft({ title: song.title, artist: song.artist ?? '' });
    setYoutubeError(null);
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
  const allCreatorSongsMatched = creatorPersonalSongs.length > 0
    && creatorPersonalSongs.every((song) => song.artist && song.youtube_video_id);
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
            <p>Add song titles and artists by mood, confirm the intended YouTube videos, then build one private playlist in your connected YouTube account.</p>
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
                    onChange={(event) => {
                      const mood = event.target.value as ExpressionLabel | '';
                      setSongMood(mood);
                      setYoutubePlaylistTitle(moodPlaylistTitle(mood));
                      setCreatedYoutubePlaylist(null);
                    }}
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
                <label htmlFor="personal-song-artist">Artist
                  <input
                    id="personal-song-artist"
                    value={songArtist}
                    onChange={(event) => setSongArtist(event.target.value)}
                    maxLength={200}
                    placeholder="e.g. The Beatles"
                    required
                  />
                </label>
                <button type="submit" disabled={playlistBusy || !songMood || !songTitle.trim() || !songArtist.trim()}>
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
                      <div className="personal-song-details">
                        {editingSongId === song.id ? (
                          <form className="song-edit-form" onSubmit={(event) => void handleSongEditSubmit(event)}>
                            <label>Song title
                              <input value={songEditDraft.title} onChange={(event) => setSongEditDraft({ ...songEditDraft, title: event.target.value })} maxLength={200} required />
                            </label>
                            <label>Artist
                              <input value={songEditDraft.artist} onChange={(event) => setSongEditDraft({ ...songEditDraft, artist: event.target.value })} maxLength={200} required />
                            </label>
                            <button type="submit" disabled={songUpdateBusy || !songEditDraft.title.trim() || !songEditDraft.artist.trim()}>{songUpdateBusy ? 'Saving…' : 'Save song details'}</button>
                            <button type="button" className="secondary-button" onClick={() => setEditingSongId(null)}>Cancel</button>
                          </form>
                        ) : (
                          <>
                            <a
                              href={song.youtube_video_id
                                ? getYouTubeVideoUrl(song.youtube_video_id)
                                : getYouTubeSongSearchUrl(`${song.title} ${song.artist ?? ''}`.trim())}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <strong>{song.title}</strong>
                              <small>{song.artist || 'Artist needed'} · {song.youtube_video_title ? `Matched: ${song.youtube_video_title}` : 'YouTube match needed'} ↗</small>
                            </a>
                            <button type="button" className="text-button" onClick={() => beginSongEdit(song)}>
                              {song.artist ? 'Edit song details' : 'Add artist details'}
                            </button>
                            {song.youtube_video_id ? <small className="youtube-match-channel">YouTube channel: {song.youtube_channel_title}</small> : null}
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={matchBusyId === song.id || !song.artist}
                              onClick={() => void handleFindYouTubeMatches(song)}
                            >
                              {matchBusyId === song.id ? 'Searching…' : song.youtube_video_id ? 'Choose another match' : 'Find YouTube match'}
                            </button>
                            {youtubeMatches[song.id]?.length ? (
                              <ul className="youtube-match-list" aria-label={`YouTube matches for ${song.title}`}>
                                {youtubeMatches[song.id].map((match) => (
                                  <li key={match.video_id}>
                                    {match.thumbnail_url ? <img src={match.thumbnail_url} alt="" loading="lazy" /> : null}
                                    <span><strong>{match.title}</strong><small>{match.channel_title}</small></span>
                                    <button
                                      type="button"
                                      disabled={matchBusyId === song.id}
                                      onClick={() => void handleChooseYouTubeMatch(song.id, match)}
                                    >Use this video</button>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </>
                        )}
                      </div>
                      <button type="button" className="song-delete-button" onClick={() => void handleDeletePersonalSong(song.id)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="empty-state">No songs added to this mood yet.</p>}
              {creatorPersonalSongs.length ? (
                <section className="youtube-playlist-builder" aria-label="Create a YouTube playlist">
                  <div className="results-heading">
                    <h2>Create a YouTube playlist</h2>
                    <p>Review each song’s YouTube match, then create a private playlist in your connected YouTube account.</p>
                  </div>
                  {youtubeConnection.connected ? (
                    <div className="youtube-connection-status" role="status">
                      <span>Connected{youtubeConnection.google_email ? ` as ${youtubeConnection.google_email}` : ''}</span>
                      <button type="button" className="text-button" disabled={youtubeBusy} onClick={() => void handleDisconnectYouTube()}>Disconnect</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => void handleConnectYouTube()} disabled={youtubeBusy}>
                      {youtubeBusy ? 'Connecting…' : 'Connect YouTube account'}
                    </button>
                  )}
                  {youtubeFeedback ? <p role="status">{youtubeFeedback}</p> : null}
                  {youtubeError ? <p className="error" role="alert">{youtubeError}</p> : null}
                  {youtubeConnection.connected ? (
                    <>
                      <label htmlFor="youtube-playlist-title">Playlist name
                        <input
                          id="youtube-playlist-title"
                          value={youtubePlaylistTitle}
                          onChange={(event) => setYoutubePlaylistTitle(event.target.value)}
                          maxLength={150}
                          required
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void handleCreateYouTubePlaylist()}
                        disabled={youtubeBusy || !allCreatorSongsMatched || !youtubePlaylistTitle.trim()}
                      >
                        {youtubeBusy ? 'Creating playlist…' : `Create YouTube playlist (${creatorPersonalSongs.length} songs)`}
                      </button>
                      {!allCreatorSongsMatched ? <small>Enter an artist and confirm a YouTube match for every song above to continue.</small> : null}
                    </>
                  ) : null}
                  {createdYoutubePlaylist ? (
                    <p role="status">
                      <a href={createdYoutubePlaylist.url} target="_blank" rel="noopener noreferrer">
                        Open “{createdYoutubePlaylist.title}” on YouTube ↗
                      </a>
                      {createdYoutubePlaylist.status === 'partial'
                        ? ` · ${createdYoutubePlaylist.added_count} songs added; some could not be added.`
                        : ` · ${createdYoutubePlaylist.added_count} songs added.`}
                    </p>
                  ) : null}
                  {createdYoutubePlaylists.some((playlist) => playlist.mood === songMood) ? (
                    <div className="youtube-playlist-history" aria-label={`${songMood} YouTube playlists`}>
                      <h3>Your {songMood} YouTube playlists</h3>
                      <ul>
                        {createdYoutubePlaylists.filter((playlist) => playlist.mood === songMood).map((playlist) => (
                          <li key={playlist.id}>
                            <a href={playlist.url} target="_blank" rel="noopener noreferrer">{playlist.title} ↗</a>
                            <span>{playlist.added_count} added · {playlist.status}</span>
                            {playlist.status === 'partial' ? (
                              <button type="button" className="text-button" disabled={youtubeBusy} onClick={() => void handleRetryYouTubePlaylist(playlist.id)}>
                                {youtubeBusy ? 'Retrying…' : `Retry ${playlist.failed_song_ids.length} failed songs`}
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              ) : null}
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
                  <a
                    className="playlist-choice"
                    href={song.youtube_video_id
                      ? getYouTubeVideoUrl(song.youtube_video_id)
                      : getYouTubeSongSearchUrl(`${song.title} ${song.artist ?? ''}`.trim())}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span><strong>{song.title}</strong><small>Your personal {expression} song · {song.artist || 'Artist not added'} · {song.youtube_video_title ? `YouTube: ${song.youtube_video_title}` : 'Search YouTube'}</small></span>
                    <span className="playlist-choice-arrow" aria-hidden="true">↗</span>
                  </a>
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
          <a className="back-to-discover" href="#home">← Back to Discover</a>
        </section>
      )}
      </main>
      <footer className="site-footer">Moodify · Choose what feels right for you.</footer>
    </div>
  );
}

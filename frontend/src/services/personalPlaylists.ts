import type { ExpressionLabel } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export interface SessionUser {
  email: string;
  display_name: string;
  username: string;
  access_token: string;
  token_type: 'bearer';
  role?: 'user' | 'admin' | 'super_user';
}

export interface UserProfile {
  email: string;
  display_name: string;
  username: string;
}

export interface PersonalSong {
  id: string;
  mood: ExpressionLabel;
  title: string;
  artist?: string | null;
  youtube_video_id?: string | null;
  youtube_video_title?: string | null;
  youtube_channel_title?: string | null;
  youtube_thumbnail_url?: string | null;
  position: number;
  created_at: string;
}

export interface YouTubeMatch {
  video_id: string;
  title: string;
  channel_title: string;
  thumbnail_url: string | null;
}

export interface YouTubeConnectionStatus {
  connected: boolean;
  google_email: string | null;
  remote_revoked?: boolean | null;
}

export interface CreatedYouTubePlaylist {
  id: string;
  title: string;
  mood: ExpressionLabel;
  url: string;
  status: string;
  added_count: number;
  failed_song_ids: string[];
}

interface MessageResponse {
  message: string;
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, init);
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      throw new Error(
        `Could not reach Moodify API at ${API_BASE_URL}. Check that the backend is running and VITE_API_BASE_URL points to the correct API.`,
      );
    }
    throw error;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    const message = typeof body?.detail === 'string' ? body.detail : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetchApi(path, {
    method: 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readJson<T>(response);
}

export function registerAccount(email: string, password: string, displayName: string, username: string): Promise<MessageResponse> {
  return post('/auth/register', { email, password, display_name: displayName, username });
}

export function loginAccount(email: string, password: string): Promise<SessionUser> {
  return post('/auth/login', { email, password });
}

export function refreshSession(): Promise<SessionUser> {
  return post('/auth/refresh');
}

export function logoutAccount(): Promise<MessageResponse> {
  return post('/auth/logout');
}

export function updateAccountProfile(
  accessToken: string,
  displayName: string,
  username: string,
): Promise<UserProfile> {
  return fetchApi('/auth/me', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ display_name: displayName, username }),
  }).then(readJson<UserProfile>);
}

export function verifyAccount(token: string): Promise<MessageResponse> {
  return post('/auth/verify', { token });
}

export function requestPasswordReset(email: string): Promise<MessageResponse> {
  return post('/auth/forgot-password', { email });
}

export function resetPassword(token: string, password: string): Promise<MessageResponse> {
  return post('/auth/reset-password', { token, password });
}

export async function listPersonalSongs(accessToken: string, mood?: ExpressionLabel): Promise<PersonalSong[]> {
  const query = mood ? `?mood=${encodeURIComponent(mood)}` : '';
  const response = await fetchApi(`/personal-playlists/songs${query}`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return readJson<PersonalSong[]>(response);
}

export async function createPersonalSong(
  accessToken: string,
  mood: ExpressionLabel,
  title: string,
  artist?: string,
): Promise<PersonalSong> {
  const response = await fetchApi('/personal-playlists/songs', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ mood, title, artist }),
  });
  return readJson<PersonalSong>(response);
}

export async function updatePersonalSong(
  accessToken: string,
  id: string,
  title: string,
  artist: string,
): Promise<PersonalSong> {
  const response = await fetchApi(`/personal-playlists/songs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ title, artist }),
  });
  return readJson<PersonalSong>(response);
}

export async function getYouTubeConnection(accessToken: string): Promise<YouTubeConnectionStatus> {
  const response = await fetchApi('/youtube/connection', {
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return readJson<YouTubeConnectionStatus>(response);
}

export async function startYouTubeAuthorization(accessToken: string, mood?: ExpressionLabel): Promise<string> {
  const response = await fetchApi('/youtube/oauth/start', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ mood }),
  });
  const result = await readJson<{ authorization_url: string }>(response);
  return result.authorization_url;
}

export async function disconnectYouTube(accessToken: string): Promise<YouTubeConnectionStatus> {
  const response = await fetchApi('/youtube/connection', {
    method: 'DELETE',
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return readJson<YouTubeConnectionStatus>(response);
}

export async function findYouTubeMatches(accessToken: string, songId: string): Promise<YouTubeMatch[]> {
  const response = await fetchApi(`/youtube/songs/${encodeURIComponent(songId)}/matches`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return readJson<YouTubeMatch[]>(response);
}

export async function selectYouTubeMatch(
  accessToken: string,
  songId: string,
  videoId: string,
): Promise<PersonalSong> {
  const response = await fetchApi(`/youtube/songs/${encodeURIComponent(songId)}/match`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ video_id: videoId }),
  });
  return readJson<PersonalSong>(response);
}

export async function createYouTubePlaylist(
  accessToken: string,
  mood: ExpressionLabel,
  title: string,
): Promise<CreatedYouTubePlaylist> {
  const response = await fetchApi('/youtube/playlists', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ mood, title }),
  });
  return readJson<CreatedYouTubePlaylist>(response);
}

export async function listYouTubePlaylists(accessToken: string, mood?: ExpressionLabel): Promise<CreatedYouTubePlaylist[]> {
  const query = mood ? `?mood=${encodeURIComponent(mood)}` : '';
  const response = await fetchApi(`/youtube/playlists${query}`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return readJson<CreatedYouTubePlaylist[]>(response);
}

export async function retryYouTubePlaylist(accessToken: string, playlistId: string): Promise<CreatedYouTubePlaylist> {
  const response = await fetchApi(`/youtube/playlists/${encodeURIComponent(playlistId)}/retry`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return readJson<CreatedYouTubePlaylist>(response);
}

export async function deletePersonalSong(accessToken: string, id: string): Promise<void> {
  const response = await fetchApi(`/personal-playlists/songs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed with status ${response.status}`);
  }
}

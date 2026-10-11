import type { ExpressionLabel } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

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
  position: number;
  created_at: string;
}

interface MessageResponse {
  message: string;
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
  const response = await fetch(`${API_BASE_URL}${path}`, {
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
  return fetch(`${API_BASE_URL}/auth/me`, {
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
  const response = await fetch(`${API_BASE_URL}/personal-playlists/songs${query}`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return readJson<PersonalSong[]>(response);
}

export async function createPersonalSong(
  accessToken: string,
  mood: ExpressionLabel,
  title: string,
): Promise<PersonalSong> {
  const response = await fetch(`${API_BASE_URL}/personal-playlists/songs`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ mood, title }),
  });
  return readJson<PersonalSong>(response);
}

export async function deletePersonalSong(accessToken: string, id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/personal-playlists/songs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed with status ${response.status}`);
  }
}

import type { Track } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

export type AccountRole = 'user' | 'admin' | 'super_user';

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  username: string;
  role: AccountRole;
  is_verified: boolean;
  is_suspended: boolean;
  created_at: string;
}

export interface AdminMetrics {
  users_total: number;
  users_verified: number;
  users_suspended: number;
  songs_total: number;
}

export interface AdminAuditRecord {
  id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  action: string;
  details: string;
  created_at: string;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function request<T>(accessToken: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/admin${path}`, {
    method,
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readJson<T>(response);
}

export function listAdminUsers(accessToken: string, query = ''): Promise<AdminUser[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  const suffix = params.size ? `?${params.toString()}` : '';
  return request(accessToken, `/users${suffix}`);
}

export function getAdminMetrics(accessToken: string): Promise<AdminMetrics> {
  return request(accessToken, '/metrics');
}

export function setUserSuspension(accessToken: string, userId: string, suspended: boolean): Promise<AdminUser> {
  return request(accessToken, `/users/${encodeURIComponent(userId)}/suspension`, 'PUT', { suspended });
}

export function setUserRole(accessToken: string, userId: string, role: AccountRole): Promise<AdminUser> {
  return request(accessToken, `/users/${encodeURIComponent(userId)}/role`, 'PUT', { role });
}

export function deleteManagedUser(accessToken: string, userId: string): Promise<{ message: string }> {
  return request(accessToken, `/users/${encodeURIComponent(userId)}`, 'DELETE');
}

export function getAdminAudit(accessToken: string): Promise<AdminAuditRecord[]> {
  return request(accessToken, '/audit');
}

export interface AdminTrack extends Track {
  expression_affinities: Record<string, number>;
}

export interface RecommendationWeights {
  goal_tag_weight: number;
  language_match_weight: number;
  genre_match_weight: number;
  expression_affinity_weight: number;
  energy_weight: number;
}

export interface AdminOperationalStatus {
  status: string;
  environment: string;
  api_version: string;
  database: string;
}

export function listAdminCatalogue(accessToken: string): Promise<AdminTrack[]> {
  return request(accessToken, '/catalogue');
}

export function createCatalogueTrack(accessToken: string, track: AdminTrack): Promise<AdminTrack> {
  return request(accessToken, '/catalogue', 'POST', track);
}

export function updateCatalogueTrack(accessToken: string, track: AdminTrack): Promise<AdminTrack> {
  return request(accessToken, `/catalogue/${encodeURIComponent(track.id)}`, 'PUT', track);
}

export function deleteCatalogueTrack(accessToken: string, trackId: string): Promise<{ message: string }> {
  return request(accessToken, `/catalogue/${encodeURIComponent(trackId)}`, 'DELETE');
}

export function getRecommendationWeights(accessToken: string): Promise<RecommendationWeights> {
  return request(accessToken, '/settings/recommendations');
}

export function saveRecommendationWeights(accessToken: string, weights: RecommendationWeights): Promise<RecommendationWeights> {
  return request(accessToken, '/settings/recommendations', 'PUT', weights);
}

export function getAdminOperationalStatus(accessToken: string): Promise<AdminOperationalStatus> {
  return request(accessToken, '/status');
}
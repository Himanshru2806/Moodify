import type { ExpressionLabel, ListeningGoal, RecommendationResponse } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

export async function getHealth(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/health`);
  return readJson(response);
}

export async function getRecommendations(request: {
  expression: ExpressionLabel | null;
  listening_goal: ListeningGoal;
  languages: string[];
  genres: string[];
  limit: number;
}): Promise<RecommendationResponse> {
  const response = await fetch(`${API_BASE_URL}/recommendations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  return readJson(response);
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

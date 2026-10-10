import type { ExpressionLabel, ExpressionPrediction, ListeningGoal, RecommendationResponse } from '../types';

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

export async function predictExpression(image: Blob, filename = 'capture.jpg'): Promise<ExpressionPrediction> {
  const formData = new FormData();
  formData.append('image', image, filename);

  const response = await fetch(`${API_BASE_URL}/expressions/predict`, {
    method: 'POST',
    body: formData,
  });

  return readJson(response);
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    const message = typeof body?.detail === 'string' ? body.detail : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

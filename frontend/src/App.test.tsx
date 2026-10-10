/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { getHealth, getRecommendations, predictExpression } from './services/api';
import type { ExpressionPrediction, RecommendationResponse } from './types';

vi.mock('./services/api', () => ({
  getHealth: vi.fn(),
  getRecommendations: vi.fn(),
  predictExpression: vi.fn(),
}));

const prediction: ExpressionPrediction = {
  expression: 'happy',
  confidence: 0.82,
  probabilities: {
    angry: 0.02,
    disgust: 0.01,
    fear: 0.02,
    happy: 0.82,
    sad: 0.03,
    surprise: 0.04,
    neutral: 0.06,
  },
  status: 'prediction_available',
  model_version: 'test-model',
};

const recommendationResponse: RecommendationResponse = {
  listening_goal: 'help_me_focus',
  expression: 'happy',
  items: [],
};

describe('photo recommendations', () => {
  beforeEach(() => {
    vi.mocked(getHealth).mockResolvedValue({ status: 'ok' });
    vi.mocked(getRecommendations).mockResolvedValue(recommendationResponse);
    vi.mocked(predictExpression).mockResolvedValue(prediction);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('automatically recommends after an upload using the current preferences', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByLabelText('Listening goal'), 'energize_me');
    await user.clear(screen.getByLabelText('Languages'));
    await user.type(screen.getByLabelText('Languages'), 'Hindi, English');
    await user.clear(screen.getByLabelText('Genres'));
    await user.type(screen.getByLabelText('Genres'), 'pop, indie');
    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }),
    );

    await screen.findByText(/Expression: happy/);
    await waitFor(() => expect(getRecommendations).toHaveBeenCalledWith({
      expression: 'happy',
      listening_goal: 'energize_me',
      languages: ['Hindi', 'English'],
      genres: ['pop', 'indie'],
      limit: 5,
    }));
  });

  it('still recommends from current preferences when the model is uncertain', async () => {
    const user = userEvent.setup();
    vi.mocked(predictExpression).mockResolvedValue({ ...prediction, expression: null, status: 'uncertain' });
    render(<App />);

    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }),
    );

    await screen.findByText(/Status: uncertain/);
    await waitFor(() => expect(getRecommendations).toHaveBeenCalledWith({
      expression: null,
      listening_goal: 'help_me_focus',
      languages: ['English', 'Hindi', 'Instrumental'],
      genres: ['indie', 'pop', 'lofi'],
      limit: 5,
    }));
  });

  it('automatically recommends after a camera capture', async () => {
    const user = userEvent.setup();
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', { configurable: true, writable: true, value: null });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({ drawImage: vi.fn() }),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: (callback: BlobCallback) => callback(new Blob(['capture'], { type: 'image/jpeg' })),
    });

    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Start camera' }));
    await user.click(await screen.findByRole('button', { name: 'Click photo' }));

    await waitFor(() => expect(predictExpression).toHaveBeenCalledWith(expect.any(Blob), 'camera-capture.jpg'));
    await waitFor(() => expect(getRecommendations).toHaveBeenCalledWith({
      expression: 'happy',
      listening_goal: 'help_me_focus',
      languages: ['English', 'Hindi', 'Instrumental'],
      genres: ['indie', 'pop', 'lofi'],
      limit: 5,
    }));
  });

  it('shows a playlist error without hiding the successful expression prediction', async () => {
    const user = userEvent.setup();
    vi.mocked(getRecommendations).mockRejectedValue(new Error('Recommendation service unavailable.'));
    render(<App />);

    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }),
    );

    await screen.findByText(/Expression: happy/);
    expect(await screen.findByText('Recommendation service unavailable.')).toBeTruthy();
    expect(predictExpression).toHaveBeenCalledOnce();
  });
});

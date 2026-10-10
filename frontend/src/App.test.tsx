/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { getHealth, getRecommendations, predictExpression } from './services/api';
import {
  clearPersonalDataset,
  createContributionId,
  deletePersonalDatasetContribution,
  listPersonalDatasetContributions,
  savePersonalDatasetContribution,
} from './services/personalDataset';
import type { ExpressionPrediction } from './types';
import type { PersonalDatasetContribution } from './services/personalDataset';

vi.mock('./services/api', () => ({
  getHealth: vi.fn(),
  getRecommendations: vi.fn(),
  predictExpression: vi.fn(),
}));

vi.mock('./services/personalDataset', () => ({
  clearPersonalDataset: vi.fn(),
  createContributionId: vi.fn(() => 'photo-test-id'),
  deletePersonalDatasetContribution: vi.fn(),
  listPersonalDatasetContributions: vi.fn(),
  savePersonalDatasetContribution: vi.fn(),
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

describe('mood playlist choices', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(getHealth).mockResolvedValue({ status: 'ok' });
    vi.mocked(predictExpression).mockResolvedValue(prediction);
    vi.mocked(createContributionId).mockReturnValue('photo-test-id');
    vi.mocked(listPersonalDatasetContributions).mockResolvedValue([]);
    vi.mocked(savePersonalDatasetContribution).mockResolvedValue('photo-test-id');
    vi.mocked(deletePersonalDatasetContribution).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('shows happy playlist choices only when requested and does not call ranked recommendations', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }),
    );

    await screen.findByText(/Detected expression: happy/);
    expect(screen.queryByRole('link', { name: /Party & dance/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show Playlist' }));

    expect(await screen.findByRole('heading', { name: 'Your visible expression seems Happy' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Soulful & feel-good/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Party & dance/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Romantic/ })).toBeTruthy();
    expect(screen.queryByText('Deep Work')).toBeNull();
    expect(getRecommendations).not.toHaveBeenCalled();
  });

  it('updates playlist choices after returning to Discover to correct the expression', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByText(/Detected expression: happy/);

    expect(screen.queryByRole('link', { name: /Party & dance/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show Playlist' }));
    await screen.findByRole('heading', { name: 'Your visible expression seems Happy' });
    await user.click(screen.getByRole('link', { name: 'Discover' }));
    await user.selectOptions(screen.getByLabelText('Correct detected expression'), 'sad');
    expect(screen.getByText(/Detected expression: happy/)).toBeTruthy();
    expect(getRecommendations).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Show Playlist' }));
    expect(await screen.findByRole('heading', { name: 'You selected Sad' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Uplifting & hopeful/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Soothing Bhajans/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Gentle comfort/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Party & dance/ })).toBeNull();
  });

  it('offers general styles when the model is uncertain and no mood is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(predictExpression).mockResolvedValue({ ...prediction, expression: null, status: 'uncertain' });
    render(<App />);

    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }),
    );

    await screen.findByText(/Visible-expression estimate: uncertain/);
    expect(screen.getByLabelText('Choose an expression (optional)')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Choose an expression (optional)'), 'sad');
    expect(screen.queryByLabelText(/I consent to save this photo/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show Playlist' }));
    expect(await screen.findByRole('heading', { name: 'You selected Sad' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Uplifting & hopeful/ })).toBeTruthy();
    expect(getRecommendations).not.toHaveBeenCalled();
  });

  it('includes a Hanuman Chalisa devotional choice for fear', async () => {
    const user = userEvent.setup();
    vi.mocked(predictExpression).mockResolvedValue({ ...prediction, expression: 'fear' });
    render(<App />);

    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByText(/Detected expression: fear/);
    await user.click(screen.getByRole('button', { name: 'Show Playlist' }));

    expect(await screen.findByRole('link', { name: /Calming & grounding/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Devotional · Hanuman Chalisa/ })).toBeTruthy();
  });

  it('opens a playlist-filtered YouTube search in a new tab when a choice is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(predictExpression).mockResolvedValue({ ...prediction, expression: 'fear' });
    render(<App />);

    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByText(/Detected expression: fear/);
    await user.click(screen.getByRole('button', { name: 'Show Playlist' }));

    const link = await screen.findByRole('link', { name: /Devotional · Hanuman Chalisa/ });
    const url = new URL(link.getAttribute('href') ?? '');
    expect(url.origin + url.pathname).toBe('https://www.youtube.com/results');
    expect(url.searchParams.get('search_query')).toBe('Hanuman Chalisa devotional playlist');
    expect(url.searchParams.get('sp')).toBe('EgIQAw%3D%3D');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows the expression correction after a prediction is available', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByLabelText('Choose an expression (optional)')).toBeNull();
    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }),
    );
    expect(await screen.findByLabelText('Correct detected expression')).toBeTruthy();
    expect(screen.queryByLabelText('Choose an expression (optional)')).toBeNull();
  });

  it('scrolls the prediction panel into view immediately and respects reduced motion', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    let resolvePrediction!: (result: ExpressionPrediction) => void;
    vi.mocked(predictExpression).mockReturnValue(new Promise((resolve) => {
      resolvePrediction = resolve;
    }));
    render(<App />);

    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }),
    );

    expect(await screen.findByText('Analyzing your photo…')).toBeTruthy();
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Your expression estimate will appear here')).toBeTruthy();

    await act(async () => resolvePrediction(prediction));
    expect(screen.queryByText(/Detected expression: happy/)).toBeNull();
    expect(screen.getByText('Your expression estimate will appear here')).toBeTruthy();
  });

  it('clears the previous result and allows the same image to be uploaded again', async () => {
    const user = userEvent.setup();
    render(<App />);
    const image = new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' });
    const upload = screen.getByLabelText('Upload image');

    await user.upload(upload, image);
    await screen.findByText(/Detected expression: happy/);
    await user.selectOptions(screen.getByLabelText('Correct detected expression'), 'sad');
    expect(screen.getByLabelText(/I consent to save this photo/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Your expression estimate will appear here')).toBeTruthy();
    expect((upload as HTMLInputElement).value).toBe('');
    expect(screen.queryByLabelText(/expression \(optional\)/i)).toBeNull();
    expect(screen.queryByLabelText(/I consent to save this photo/)).toBeNull();

    await user.upload(upload, image);
    expect(await screen.findByText(/Detected expression: happy/)).toBeTruthy();
    expect(predictExpression).toHaveBeenCalledTimes(2);
  });

  it('shows the expression correction after a prediction is available', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByLabelText('Choose an expression (optional)')).toBeNull();
    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }),
    );
    expect(await screen.findByLabelText('Correct detected expression')).toBeTruthy();
    expect(screen.queryByLabelText('Choose an expression (optional)')).toBeNull();
  });

  it('saves a corrected photo only after specific consent and only to the local personal dataset', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['private photo bytes'], 'portrait.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByText(/Detected expression: happy/);
    await user.selectOptions(screen.getByLabelText('Correct detected expression'), 'sad');

    const consent = screen.getByLabelText(/I consent to save this photo/);
    const saveButton = screen.getByRole('button', { name: 'Save photo for my personal dataset' });
    expect(saveButton.hasAttribute('disabled')).toBe(true);
    expect(savePersonalDatasetContribution).not.toHaveBeenCalled();

    await user.click(consent);
    await user.click(saveButton);

    await waitFor(() => expect(savePersonalDatasetContribution).toHaveBeenCalledOnce());
    const savedContribution = vi.mocked(savePersonalDatasetContribution).mock.calls[0][0];
    expect(savedContribution.expression).toBe('sad');
    expect(await savedContribution.image.text()).toBe('private photo bytes');
    expect(await screen.findByText(/personal model training is not implemented yet/i)).toBeTruthy();
  });

  it('does not offer image persistence for an unchanged prediction', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['private photo bytes'], 'portrait.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByText(/Detected expression: happy/);

    expect(savePersonalDatasetContribution).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save photo for my personal dataset' })).toBeNull();
    expect(screen.queryByLabelText(/I consent to save this photo/)).toBeNull();
  });

  it('reports local storage failures without affecting the prediction', async () => {
    const user = userEvent.setup();
    vi.mocked(savePersonalDatasetContribution).mockRejectedValue(new Error('Browser storage unavailable.'));
    render(<App />);

    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['private photo bytes'], 'portrait.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByText(/Detected expression: happy/);
    await user.selectOptions(screen.getByLabelText('Correct detected expression'), 'sad');
    await user.click(screen.getByLabelText(/I consent to save this photo/));
    await user.click(screen.getByRole('button', { name: 'Save photo for my personal dataset' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Browser storage unavailable.');
    expect(screen.getByText(/Detected expression: happy/)).toBeTruthy();
    expect((screen.getByLabelText('Correct detected expression') as HTMLSelectElement).value).toBe('sad');
  });

  it('lists local contributions and provides per-photo deletion', async () => {
    const user = userEvent.setup();
    const savedRecord: PersonalDatasetContribution = {
      id: 'saved-one',
      image: new Blob(['photo'], { type: 'image/jpeg' }),
      expression: 'neutral',
      createdAt: '2026-10-11T10:00:00.000Z',
    };
    vi.mocked(listPersonalDatasetContributions)
      .mockResolvedValueOnce([savedRecord])
      .mockResolvedValueOnce([]);
    render(<App />);

    expect(screen.queryByRole('heading', { name: 'My personal dataset' })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'My dataset' }));
    expect(await screen.findByText(/1 opted-in photo saved locally/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete photo' }));

    await waitFor(() => expect(deletePersonalDatasetContribution).toHaveBeenCalledWith('saved-one'));
    expect(await screen.findByText(/0 opted-in photos saved locally/)).toBeTruthy();
  });

  it('requires confirmation before deleting the complete local personal dataset', async () => {
    const user = userEvent.setup();
    vi.mocked(listPersonalDatasetContributions).mockResolvedValueOnce([{
      id: 'saved-one',
      image: new Blob(['photo'], { type: 'image/jpeg' }),
      expression: 'neutral',
      createdAt: '2026-10-11T10:00:00.000Z',
    }]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);

    await user.click(screen.getByRole('link', { name: 'My dataset' }));
    await user.click(await screen.findByRole('button', { name: 'Delete all personal photos' }));

    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(clearPersonalDataset).toHaveBeenCalledOnce());
    expect(await screen.findByText(/0 opted-in photos saved locally/)).toBeTruthy();
    confirm.mockRestore();
  });

  it('shows expression-based options after camera capture without calling ranked recommendations', async () => {
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
    expect(screen.queryByRole('link', { name: /Party & dance/ })).toBeNull();
    expect(getRecommendations).not.toHaveBeenCalled();

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Your expression estimate will appear here')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop camera' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Click photo' }));
    await waitFor(() => expect(predictExpression).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Show Playlist' }));
    expect(screen.getByRole('link', { name: /Party & dance/ })).toBeTruthy();
  });
});

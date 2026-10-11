/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import {
  getAdminAudit,
  getAdminMetrics,
  getAdminOperationalStatus,
  getRecommendationWeights,
  listAdminCatalogue,
  listAdminUsers,
} from './services/admin';
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
import {
  createPersonalSong,
  listPersonalSongs,
  loginAccount,
  logoutAccount,
  registerAccount,
  refreshSession,
  updateAccountProfile,
} from './services/personalPlaylists';
import type { PersonalSong } from './services/personalPlaylists';

vi.mock('./services/api', () => ({
  getHealth: vi.fn(),
  getRecommendations: vi.fn(),
  predictExpression: vi.fn(),
}));

vi.mock('./services/admin', () => ({
  createCatalogueTrack: vi.fn(),
  deleteCatalogueTrack: vi.fn(),
  deleteManagedUser: vi.fn(),
  getAdminAudit: vi.fn(),
  getAdminMetrics: vi.fn(),
  getAdminOperationalStatus: vi.fn(),
  getRecommendationWeights: vi.fn(),
  listAdminCatalogue: vi.fn(),
  listAdminUsers: vi.fn(),
  saveRecommendationWeights: vi.fn(),
  setUserRole: vi.fn(),
  setUserSuspension: vi.fn(),
  updateCatalogueTrack: vi.fn(),
}));

vi.mock('./services/personalDataset', () => ({
  clearPersonalDataset: vi.fn(),
  createContributionId: vi.fn(() => 'photo-test-id'),
  deletePersonalDatasetContribution: vi.fn(),
  listPersonalDatasetContributions: vi.fn(),
  savePersonalDatasetContribution: vi.fn(),
}));

vi.mock('./services/personalPlaylists', () => ({
  createPersonalSong: vi.fn(),
  deletePersonalSong: vi.fn(),
  listPersonalSongs: vi.fn(),
  loginAccount: vi.fn(),
  logoutAccount: vi.fn(),
  refreshSession: vi.fn(),
  registerAccount: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  updateAccountProfile: vi.fn(),
  verifyAccount: vi.fn(),
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
    vi.mocked(refreshSession).mockRejectedValue(new Error('No active session'));
    vi.mocked(listPersonalSongs).mockResolvedValue([]);
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    vi.mocked(getAdminMetrics).mockResolvedValue({ users_total: 0, users_verified: 0, users_suspended: 0, songs_total: 0 });
    vi.mocked(getAdminOperationalStatus).mockResolvedValue({ status: 'ok', environment: 'test', api_version: '0.1.0', database: 'ok' });
    vi.mocked(listAdminCatalogue).mockResolvedValue([]);
    vi.mocked(getRecommendationWeights).mockResolvedValue({ goal_tag_weight: 2, language_match_weight: 1, genre_match_weight: 1, expression_affinity_weight: 0.5, energy_weight: 1 });
    vi.mocked(getAdminAudit).mockResolvedValue([]);
    vi.mocked(loginAccount).mockResolvedValue({ email: 'listener@example.com', display_name: 'Listener', username: 'listener', access_token: 'test-access', token_type: 'bearer' });
    vi.mocked(registerAccount).mockResolvedValue({ message: 'Check your email for a verification link.' });
    vi.mocked(createPersonalSong).mockResolvedValue({
      id: 'song-new', mood: 'happy', title: 'Here Comes the Sun', position: 1, created_at: '2026-10-11T00:00:00Z',
    });
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

  it('gates the personal playlist creator behind sign-in and preserves the chosen mood', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText('Upload image'), new File(['photo'], 'portrait.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/Detected expression: happy/);
    await user.click(screen.getByRole('link', { name: 'Create playlist' }));

    expect(await screen.findByRole('heading', { name: 'Create your playlist' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in or create an account' }).getAttribute('href')).toContain('mood=happy');
    await user.click(screen.getByRole('link', { name: 'Sign in or create an account' }));
    await screen.findByRole('heading', { name: 'Welcome back' });
    await user.type(screen.getByLabelText('Email'), 'listener@example.com');
    await user.type(screen.getByLabelText(/Password/), 'a-long-enough-test-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'Create your playlist' });
    expect((screen.getByLabelText('Mood') as HTMLSelectElement).value).toBe('happy');
    expect(loginAccount).toHaveBeenCalled();
  });

  it('lands on Discover after signing in directly from the account page', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `${window.location.pathname}#account`);
    render(<App />);

    await screen.findByRole('heading', { name: 'Welcome back' });
    await user.type(screen.getByLabelText('Email'), 'listener@example.com');
    await user.type(screen.getByLabelText(/Password/), 'a-long-enough-test-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Find your next mood.' })).toBeTruthy();
    expect(window.location.hash).toBe('#home');
    expect(loginAccount).toHaveBeenCalledWith('listener@example.com', 'a-long-enough-test-password');
  });

  it('gates admin tools by role and loads the super-user console', async () => {
    vi.mocked(refreshSession).mockResolvedValue({
      email: 'owner@example.com', display_name: 'Owner', username: 'owner', access_token: 'owner-token', token_type: 'bearer', role: 'super_user',
    });
    window.history.replaceState(null, '', `${window.location.pathname}#admin`);
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Moodify administration' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Recommendation catalogue' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recommendation settings' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recent admin actions' })).toBeTruthy();
    expect(getAdminMetrics).toHaveBeenCalledWith('owner-token');

    cleanup();
    vi.mocked(refreshSession).mockResolvedValue({
      email: 'listener@example.com', display_name: 'Listener', username: 'listener', access_token: 'user-token', token_type: 'bearer', role: 'user',
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Admin access required' })).toBeTruthy();
    expect(getAdminMetrics).toHaveBeenCalledTimes(1);
  });

  it('collects a display name and username at signup and supports password visibility', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `${window.location.pathname}#account`);
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'New to Moodify? Create an account' }));
    await user.type(screen.getByLabelText('Email'), 'listener@example.com');
    await user.type(screen.getByLabelText('Display name'), 'Mood Listener');
    await user.type(screen.getByLabelText(/^Username/), 'mood_listener');
    const password = screen.getByLabelText(/^Password/) as HTMLInputElement;
    expect(password.type).toBe('password');
    await user.type(password, 'a-long-enough-test-password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.type).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(registerAccount).toHaveBeenCalledWith('listener@example.com', 'a-long-enough-test-password', 'Mood Listener', 'mood_listener');
  });

  it('offers sign out in the header and renders editable account profile information', async () => {
    const user = userEvent.setup();
    vi.mocked(refreshSession).mockResolvedValue({
      email: 'listener@example.com', display_name: 'Listener', username: 'listener', access_token: 'test-access', token_type: 'bearer',
    });
    vi.mocked(updateAccountProfile).mockResolvedValue({ email: 'listener@example.com', display_name: 'Mood Listener', username: 'mood_listener' });
    window.history.replaceState(null, '', `${window.location.pathname}#account`);
    render(<App />);

    expect(await screen.findByText('@listener')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Mood Listener');
    await user.clear(screen.getByLabelText(/^Username/));
    await user.type(screen.getByLabelText(/^Username/), 'mood_listener');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(updateAccountProfile).toHaveBeenCalledWith('test-access', 'Mood Listener', 'mood_listener');
    expect(await screen.findByText('@mood_listener')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logoutAccount).toHaveBeenCalled();
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy();
  });

  it('allows showing and hiding the password on the reset page', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `${window.location.pathname}#reset-password?token=valid-reset-token`);
    render(<App />);

    const password = screen.getByLabelText(/^New password/) as HTMLInputElement;
    expect(password.type).toBe('password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.type).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password.type).toBe('password');
  });

  it('puts saved personal songs before built-in ideas and adds a title to the selected mood', async () => {
    const user = userEvent.setup();
    const song: PersonalSong = { id: 'song-1', mood: 'happy', title: 'Yellow', position: 1, created_at: '2026-10-11T00:00:00Z' };
    vi.mocked(refreshSession).mockResolvedValue({ email: 'listener@example.com', display_name: 'Listener', username: 'listener', access_token: 'test-access', token_type: 'bearer' });
    vi.mocked(listPersonalSongs).mockResolvedValue([song]);
    window.history.replaceState(null, '', `${window.location.pathname}#playlists?mood=happy`);

    render(<App />);

    const personalLink = await screen.findByRole('link', { name: /Yellow/ });
    const partyLink = screen.getByRole('link', { name: /Party & dance/ });
    expect(personalLink.compareDocumentPosition(partyLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(personalLink.getAttribute('href')).toContain('search_query=Yellow');

    await user.click(screen.getByRole('link', { name: /Add your own songs/ }));
    await screen.findByRole('heading', { name: 'Create your playlist' });
    expect((screen.getByLabelText('Mood') as HTMLSelectElement).value).toBe('happy');
    await user.type(screen.getByLabelText('Song title'), 'Here Comes the Sun');
    await user.click(screen.getByRole('button', { name: 'Add song' }));
    expect(await screen.findByRole('link', { name: /Here Comes the Sun/ })).toBeTruthy();
    expect(createPersonalSong).toHaveBeenCalledWith('test-access', 'happy', 'Here Comes the Sun');
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

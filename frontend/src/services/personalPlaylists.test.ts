import { afterEach, describe, expect, it, vi } from 'vitest';

import { createYouTubePlaylist, findYouTubeMatches } from './personalPlaylists';

describe('YouTube song search errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('explains how to diagnose an API network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(findYouTubeMatches('access-token', 'song-1')).rejects.toThrow(
      /Could not reach Moodify API at \/api\/v1.*backend is running.*VITE_API_BASE_URL/,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/youtube/songs/song-1/matches',
      expect.any(Object),
    );
  });

  it('uses the same connection guidance when playlist creation cannot reach the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(createYouTubePlaylist('access-token', 'happy', 'Moodify'))
      .rejects.toThrow(/Could not reach Moodify API/);
  });

  it('preserves actionable errors returned by the backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: 'YouTube search is not configured on this server.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(findYouTubeMatches('access-token', 'song-1')).rejects.toThrow(
      'YouTube search is not configured on this server.',
    );
  });
});

import { describe, expect, it } from 'vitest';

import { getYouTubeSongSearchUrl } from './streaming';

describe('YouTube song search links', () => {
  it('encodes a title as a search query without claiming an exact track link', () => {
    const url = new URL(getYouTubeSongSearchUrl('Here Comes the Sun — (Remastered)'));
    expect(url.origin + url.pathname).toBe('https://www.youtube.com/results');
    expect(url.searchParams.get('search_query')).toBe('Here Comes the Sun — (Remastered)');
    expect(url.searchParams.has('sp')).toBe(false);
  });
});

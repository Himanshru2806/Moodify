export function getYouTubePlaylistSearchUrl(searchQuery: string): string {
  const query = new URLSearchParams({
    search_query: /playlist/i.test(searchQuery) ? searchQuery : `${searchQuery} playlist`,
    sp: 'EgIQAw%3D%3D',
  });
  return `https://www.youtube.com/results?${query.toString()}`;
}

export function getYouTubeSongSearchUrl(title: string): string {
  const query = new URLSearchParams({ search_query: title });
  return `https://www.youtube.com/results?${query.toString()}`;
}

export function getYouTubeVideoUrl(videoId: string): string {
  const query = new URLSearchParams({ v: videoId });
  return `https://www.youtube.com/watch?${query.toString()}`;
}
import type { ExpressionLabel } from '../types';

export interface PlaylistChoice {
  label: string;
  searchQuery: string;
  description: string;
}

const generalChoices: PlaylistChoice[] = [
  { label: 'Soulful & feel-good', searchQuery: 'soulful feel good music', description: 'Warm songs for an easy lift.' },
  { label: 'Party & dance', searchQuery: 'party dance music', description: 'Upbeat playlists to move to.' },
  { label: 'Romantic', searchQuery: 'romantic love songs', description: 'Soft songs for a romantic mood.' },
  { label: 'Calm & relaxing', searchQuery: 'calm relaxing music', description: 'Unwind with gentle sounds.' },
  { label: 'Focus & study', searchQuery: 'focus study instrumental music', description: 'Steady background music.' },
];

const choicesByExpression: Record<ExpressionLabel, PlaylistChoice[]> = {
  happy: [
    generalChoices[0],
    generalChoices[1],
    generalChoices[2],
    generalChoices[3],
  ],
  sad: [
    { label: 'Uplifting & hopeful', searchQuery: 'uplifting hopeful songs playlist', description: 'A little brightness, at your pace.' },
    { label: 'Gentle comfort', searchQuery: 'gentle comforting songs playlist', description: 'Soft music for a quieter moment.' },
    { label: 'Soothing Bhajans', searchQuery: 'soothing bhajans playlist', description: 'Gentle devotional songs for comfort and reflection.' },
    { label: 'Soulful reflection', searchQuery: 'soulful reflective music playlist', description: 'Thoughtful songs with feeling.' },
    { label: 'Calm instrumental', searchQuery: 'calm instrumental music playlist', description: 'Peaceful music without lyrics.' },
  ],
  fear: [
    { label: 'Calming & grounding', searchQuery: 'calming grounding music playlist', description: 'Gentle sounds to help you settle.' },
    { label: 'Peaceful instrumental', searchQuery: 'peaceful instrumental music playlist', description: 'A quiet, lyric-free option.' },
    { label: 'Soft & comforting', searchQuery: 'soft comforting songs playlist', description: 'Warm, reassuring songs.' },
    { label: 'Devotional · Hanuman Chalisa', searchQuery: 'Hanuman Chalisa devotional playlist', description: 'A devotional playlist featuring the Hanuman Chalisa.' },
  ],
  angry: [
    { label: 'Cool down & unwind', searchQuery: 'calm cool down relaxing music playlist', description: 'Take things down a notch.' },
    { label: 'Energetic release', searchQuery: 'high energy workout rock playlist', description: 'Channel some energy into music.' },
    { label: 'Calm instrumental', searchQuery: 'calm instrumental music playlist', description: 'Steady sounds without lyrics.' },
    { label: 'Positive reset', searchQuery: 'positive uplifting songs playlist', description: 'A fresh, brighter sound.' },
  ],
  disgust: [
    { label: 'Light & refreshing', searchQuery: 'light refreshing feel good music playlist', description: 'Easy listening for a reset.' },
    { label: 'Uplifting', searchQuery: 'uplifting positive music playlist', description: 'Brighten the soundtrack.' },
    { label: 'Peaceful', searchQuery: 'peaceful relaxing music playlist', description: 'Gentle sounds to unwind.' },
    { label: 'Soulful', searchQuery: 'soulful music playlist', description: 'Expressive songs with warmth.' },
  ],
  surprise: [
    { label: 'Celebrate & upbeat', searchQuery: 'celebration upbeat party music playlist', description: 'Keep the good energy going.' },
    { label: 'Discover something new', searchQuery: 'new music discovery mix playlist', description: 'Explore a mix of sounds.' },
    { label: 'Chill out', searchQuery: 'chill relaxing music playlist', description: 'Take a calmer turn.' },
    { label: 'Feel-good favorites', searchQuery: 'feel good hits playlist', description: 'Familiar songs with a lift.' },
  ],
  neutral: [
    generalChoices[4],
    generalChoices[3],
    generalChoices[0],
    generalChoices[1],
  ],
};

export function getPlaylistChoices(expression: ExpressionLabel | null): PlaylistChoice[] {
  return expression ? choicesByExpression[expression] : generalChoices;
}
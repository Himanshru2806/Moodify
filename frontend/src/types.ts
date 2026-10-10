export type ExpressionLabel = 'angry' | 'disgust' | 'fear' | 'happy' | 'sad' | 'surprise' | 'neutral';

export type ListeningGoal =
  | 'comfort_me'
  | 'lift_my_mood'
  | 'match_my_current_vibe'
  | 'help_me_relax'
  | 'energize_me'
  | 'help_me_focus';

export interface Track {
  id: string;
  title: string;
  artist: string;
  language: string;
  genre: string;
  energy: number;
  tags: string[];
  source_url?: string | null;
}

export interface RecommendationItem {
  track: Track;
  rank: number;
  score: number;
  reasons: string[];
}

export interface RecommendationResponse {
  listening_goal: ListeningGoal;
  expression: ExpressionLabel | null;
  items: RecommendationItem[];
}

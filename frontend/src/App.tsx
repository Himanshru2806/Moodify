import { FormEvent, useEffect, useState } from 'react';

import { getHealth, getRecommendations } from './services/api';
import type { ExpressionLabel, ListeningGoal, RecommendationItem } from './types';

const expressionOptions: Array<{ value: ExpressionLabel | ''; label: string }> = [
  { value: '', label: 'Manual only' },
  { value: 'happy', label: 'Happy' },
  { value: 'sad', label: 'Sad' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'surprise', label: 'Surprise' },
  { value: 'angry', label: 'Angry' },
  { value: 'fear', label: 'Fear' },
  { value: 'disgust', label: 'Disgust' },
];

const goalOptions: Array<{ value: ListeningGoal; label: string }> = [
  { value: 'comfort_me', label: 'Comfort me' },
  { value: 'lift_my_mood', label: 'Lift my mood' },
  { value: 'match_my_current_vibe', label: 'Match my current vibe' },
  { value: 'help_me_relax', label: 'Help me relax' },
  { value: 'energize_me', label: 'Energize me' },
  { value: 'help_me_focus', label: 'Help me focus' },
];

export function App() {
  const [apiStatus, setApiStatus] = useState('checking');
  const [expression, setExpression] = useState<ExpressionLabel | ''>('');
  const [goal, setGoal] = useState<ListeningGoal>('help_me_focus');
  const [languages, setLanguages] = useState('English,Hindi,Instrumental');
  const [genres, setGenres] = useState('indie,pop,lofi');
  const [items, setItems] = useState<RecommendationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getHealth()
      .then((response) => {
        if (!cancelled) setApiStatus(response.status);
      })
      .catch(() => {
        if (!cancelled) setApiStatus('offline');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await getRecommendations({
        expression: expression || null,
        listening_goal: goal,
        languages: splitCsv(languages),
        genres: splitCsv(genres),
        limit: 5,
      });
      setItems(response.items);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to fetch recommendations.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Final-year project foundation</p>
          <h1>Moodify</h1>
          <p className="hero-copy">
            Facial-expression recognition will become one input to user-controlled music discovery. For now,
            the app starts with the recommendation contract and honest model status handling.
          </p>
        </div>
        <div className={`status-pill ${apiStatus === 'ok' ? 'online' : ''}`}>API: {apiStatus}</div>
      </section>

      <section className="grid">
        <article className="panel camera-panel">
          <p className="eyebrow">Expression input</p>
          <h2>Upload or camera capture</h2>
          <p>
            The backend endpoint is ready for image validation. Model inference, face detection, and live frame
            sampling are the next ML integration steps.
          </p>
          <input type="file" accept="image/png,image/jpeg,image/webp" />
          <button type="button" disabled>
            Start camera coming next
          </button>
        </article>

        <form className="panel form-panel" onSubmit={handleSubmit}>
          <p className="eyebrow">Recommendation test</p>
          <h2>Build a playlist</h2>
          <label>
            Expression
            <select value={expression} onChange={(event) => setExpression(event.target.value as ExpressionLabel | '')}>
              {expressionOptions.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Listening goal
            <select value={goal} onChange={(event) => setGoal(event.target.value as ListeningGoal)}>
              {goalOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Languages
            <input value={languages} onChange={(event) => setLanguages(event.target.value)} />
          </label>
          <label>
            Genres
            <input value={genres} onChange={(event) => setGenres(event.target.value)} />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Ranking...' : 'Get recommendations'}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </section>

      <section className="panel results-panel">
        <div className="results-heading">
          <p className="eyebrow">Ranked output</p>
          <h2>Recommended tracks</h2>
        </div>
        {items.length === 0 ? (
          <p className="empty-state">Submit the form to test the first ranking baseline.</p>
        ) : (
          <ol className="track-list">
            {items.map((item) => (
              <li key={item.track.id}>
                <span className="rank">#{item.rank}</span>
                <div>
                  <h3>{item.track.title}</h3>
                  <p>
                    {item.track.artist} | {item.track.language} | {item.track.genre} | score {item.score}
                  </p>
                  <small>{item.reasons.join(' | ')}</small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

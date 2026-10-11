from app.schemas.recommendations import RecommendationItem, RecommendationRequest, RecommendationResponse
from app.schemas.tracks import Track
from app.services.catalogue import TRACKS


GOAL_TAGS: dict[str, set[str]] = {
    "comfort_me": {"comfort", "calm", "warm"},
    "lift_my_mood": {"uplifting", "upbeat", "warm"},
    "match_my_current_vibe": {"reflective", "warm", "steady"},
    "help_me_relax": {"calm", "relax", "comfort"},
    "energize_me": {"energizing", "upbeat", "dance"},
    "help_me_focus": {"focus", "steady", "calm"},
}
EXPRESSION_AFFINITY_WEIGHT = 0.5
DEFAULT_WEIGHTS: dict[str, float] = {
    "goal_tag_weight": 2.0,
    "language_match_weight": 1.0,
    "genre_match_weight": 1.0,
    "expression_affinity_weight": EXPRESSION_AFFINITY_WEIGHT,
    "energy_weight": 1.0,
}


def recommend_tracks(
    request: RecommendationRequest,
    tracks: list[Track] | None = None,
    weights: dict[str, float] | None = None,
) -> RecommendationResponse:
    active_weights = {**DEFAULT_WEIGHTS, **(weights or {})}
    ranked = sorted(
        (_score_track(track, request, active_weights) for track in (tracks if tracks is not None else TRACKS)),
        key=lambda item: item.score,
        reverse=True,
    )

    items = [item.model_copy(update={"rank": index + 1}) for index, item in enumerate(ranked[: request.limit])]
    return RecommendationResponse(
        listening_goal=request.listening_goal,
        expression=request.expression,
        items=items,
    )


def _score_track(track: Track, request: RecommendationRequest, weights: dict[str, float]) -> RecommendationItem:
    goal_tags = GOAL_TAGS[request.listening_goal]
    matching_tags = goal_tags.intersection(track.tags)
    score = len(matching_tags) * weights["goal_tag_weight"]
    reasons: list[str] = []

    if matching_tags:
        reasons.append(f"Matches goal tags: {', '.join(sorted(matching_tags))}")

    if request.languages and track.language in request.languages:
        score += weights["language_match_weight"]
        reasons.append(f"Matches language: {track.language}")

    if request.genres and track.genre in request.genres:
        score += weights["genre_match_weight"]
        reasons.append(f"Matches genre: {track.genre}")

    if request.expression is not None:
        expression_affinity = track.expression_affinities.get(request.expression, 0.0)
        if expression_affinity:
            score += expression_affinity * weights["expression_affinity_weight"]
            reasons.append(f"Small catalogue context match: {request.expression}")

    score += track.energy * weights["energy_weight"]
    if not reasons:
        reasons.append("Included as a catalogue fallback")

    return RecommendationItem(track=track, rank=0, score=round(score, 3), reasons=reasons)

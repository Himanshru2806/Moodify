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


def recommend_tracks(request: RecommendationRequest) -> RecommendationResponse:
    ranked = sorted(
        (_score_track(track, request) for track in TRACKS),
        key=lambda item: item.score,
        reverse=True,
    )

    items = [item.model_copy(update={"rank": index + 1}) for index, item in enumerate(ranked[: request.limit])]
    return RecommendationResponse(
        listening_goal=request.listening_goal,
        expression=request.expression,
        items=items,
    )


def _score_track(track: Track, request: RecommendationRequest) -> RecommendationItem:
    goal_tags = GOAL_TAGS[request.listening_goal]
    matching_tags = goal_tags.intersection(track.tags)
    score = len(matching_tags) * 2.0
    reasons: list[str] = []

    if matching_tags:
        reasons.append(f"Matches goal tags: {', '.join(sorted(matching_tags))}")

    if request.languages and track.language in request.languages:
        score += 1.0
        reasons.append(f"Matches language: {track.language}")

    if request.genres and track.genre in request.genres:
        score += 1.0
        reasons.append(f"Matches genre: {track.genre}")

    if request.expression is not None:
        expression_affinity = track.expression_affinities.get(request.expression, 0.0)
        if expression_affinity:
            score += expression_affinity * EXPRESSION_AFFINITY_WEIGHT
            reasons.append(f"Small catalogue context match: {request.expression}")

    score += track.energy
    if not reasons:
        reasons.append("Included as a catalogue fallback")

    return RecommendationItem(track=track, rank=0, score=round(score, 3), reasons=reasons)

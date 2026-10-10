from app.schemas.tracks import Track


TRACKS: list[Track] = [
    Track(
        id="trk_001",
        title="Morning Light",
        artist="Moodify Demo",
        language="English",
        genre="indie",
        energy=0.62,
        tags=["uplifting", "warm", "focus"],
    ),
    Track(
        id="trk_002",
        title="Quiet Rain",
        artist="Moodify Demo",
        language="English",
        genre="ambient",
        energy=0.22,
        tags=["calm", "relax", "comfort"],
    ),
    Track(
        id="trk_003",
        title="City Pulse",
        artist="Moodify Demo",
        language="Hindi",
        genre="pop",
        energy=0.84,
        tags=["energizing", "upbeat", "dance"],
    ),
    Track(
        id="trk_004",
        title="Soft Echoes",
        artist="Moodify Demo",
        language="Hindi",
        genre="acoustic",
        energy=0.34,
        tags=["reflective", "comfort", "calm"],
    ),
    Track(
        id="trk_005",
        title="Deep Work",
        artist="Moodify Demo",
        language="Instrumental",
        genre="lofi",
        energy=0.48,
        tags=["focus", "steady", "calm"],
    ),
]

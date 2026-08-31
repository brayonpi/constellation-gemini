from pathlib import Path

PUBLIC_COPY_FILES = (
    "apps/web/src/App.tsx",
    "apps/web/src/components/DecisionTrace.tsx",
    "apps/web/src/components/EvidenceRoom.tsx",
    "apps/web/src/components/OrbitalGlobe.tsx",
    "apps/web/src/components/Timeline.tsx",
)
DASH_PUNCTUATION = (chr(0x2014), chr(0x2013))


def test_judge_facing_copy_does_not_use_dash_punctuation() -> None:
    for path_string in PUBLIC_COPY_FILES:
        source = Path(path_string).read_text(encoding="utf-8")
        for dash in DASH_PUNCTUATION:
            assert dash not in source, path_string

from __future__ import annotations

from constellation.telemetry import normalize_peak_rss_mb


def test_macos_peak_rss_bytes_are_normalized_to_mib() -> None:
    assert normalize_peak_rss_mb(128 * 1024 * 1024, "darwin") == 128.0


def test_linux_peak_rss_kib_are_normalized_to_mib() -> None:
    assert normalize_peak_rss_mb(128 * 1024, "linux") == 128.0

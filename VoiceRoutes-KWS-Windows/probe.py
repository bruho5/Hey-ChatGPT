"""Local Sherpa-ONNX model loader used by the desktop wake-word helper."""
from pathlib import Path

import sherpa_onnx

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "model"
STEM = "epoch-13-avg-2-chunk-16-left-64"


def load_spotter(keywords):
    return sherpa_onnx.KeywordSpotter(
        tokens=str(MODEL / "tokens.txt"),
        encoder=str(MODEL / f"encoder-{STEM}.int8.onnx"),
        decoder=str(MODEL / f"decoder-{STEM}.onnx"),
        joiner=str(MODEL / f"joiner-{STEM}.int8.onnx"),
        keywords_file=str(keywords), num_threads=2, provider="cpu",
        num_trailing_blanks=1, keywords_threshold=0.25,
    )


def decode(spotter, stream):
    while spotter.is_ready(stream):
        spotter.decode_stream(stream)
        result = spotter.get_result(stream)
        if result:
            spotter.reset_stream(stream)
            yield result

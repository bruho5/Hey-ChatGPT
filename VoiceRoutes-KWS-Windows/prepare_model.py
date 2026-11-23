"""Download and install named/pinned assets from the upstream release."""
from hashlib import sha256
from pathlib import Path
from tarfile import open as open_tar
from tempfile import TemporaryDirectory
from urllib.request import urlopen

MODEL = Path(__file__).resolve().parent / "model"
RELEASE = "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20"
URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/" + RELEASE + ".tar.bz2"
ARCHIVE_BYTES = 32885699
ARCHIVE_SHA = "68447f4fbc67e70eee3a93961f36e81e98f47aef73ce7e7ca00885c6cd3616a6"
FILES = {
    "decoder-epoch-13-avg-2-chunk-16-left-64.onnx": "63a22dd60f40fff082ac3e09afa507f6787da36df76ded2fbe145fa233e22c21",
    "encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx": "408bbd740838c42d5bf6d1c5b80b3c88b616c7860b92d980328b5b068c76ae48",
    "joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx": "190d4067b4cc20b72a42a1916e69d92052000fb7051a427ebb1bc72a69207dc1",
    "tokens.txt": "2d3f32311f9b692b964da3c90e830258d3e78e013cb0c992dbfb15cd5a1a71b0",
    "en.phone": "f7000ec3a90544c0c7c16090d8951779c2b322e14dad5006290f498567d439ea",
}


def verified(path, digest):
    return path.is_file() and sha256(path.read_bytes()).hexdigest() == digest


def unpack(archive, destination):
    # Select regular files by exact upstream path. Never call extract/extractall.
    with open_tar(archive, "r:bz2") as tar:
        for name, digest in FILES.items():
            entry = tar.getmember(f"{RELEASE}/{name}")
            if not entry.isfile() or not 0 < entry.size <= 8 * 1024 * 1024:
                raise ValueError(f"Unexpected upstream member: {name}")
            with tar.extractfile(entry) as f:
                content = f.read()
            if sha256(content).hexdigest() != digest:
                raise ValueError(f"SHA-256 mismatch: {name}")
            (destination / name).write_bytes(content)


def main():
    MODEL.mkdir(exist_ok=True)
    if not all(verified(MODEL / name, digest) for name, digest in FILES.items()):
        with TemporaryDirectory(prefix="prepare-", dir=MODEL) as d:
            scratch = Path(d)
            archive = scratch / "model.tar.bz2"
            print("Downloading the pinned Sherpa-ONNX model (33 MB)…", flush=True)
            with urlopen(URL, timeout=60) as response:
                content = response.read(ARCHIVE_BYTES + 1)
            if len(content) != ARCHIVE_BYTES or sha256(content).hexdigest() != ARCHIVE_SHA:
                raise ValueError("The official model archive did not match the expected SHA-256.")
            archive.write_bytes(content)
            unpack(archive, scratch)
            for name in FILES:
                (scratch / name).replace(MODEL / name)
    print("Model and lexicon SHA-256 verified.")


if __name__ == "__main__":
    main()

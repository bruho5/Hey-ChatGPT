# Set up Hey, ChatGPT on Windows

[简体中文](setup-zh-CN.md) · [Back to README](../README.md)

## First-time setup

1. Extract the [Windows x64 ZIP](https://github.com/bruho5/Hey-ChatGPT/releases/download/v0.3.1/Hey-ChatGPT-MyGo-0.3.1-Windows-x64.zip) to a folder you intend to keep. Close any older command-line helper and temporarily disable the older browser-only extension to avoid running two versions at once.
2. Install **64-bit Python 3.11** with the Windows `py` launcher. Run **`VoiceRoutes-KWS-Windows/Prepare-Helper.cmd`** while online. This creates a `.venv` in that folder, installs checksum-pinned Windows wheels from PyPI, and downloads and checks the pinned Sherpa-ONNX model and English lexicon from upstream. The ZIP does not include Python, the runtime, model weights, or lexicon. Once set up, wake-word recognition runs offline.
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, then choose **Load unpacked** and select **`VoiceRoutes-Web`** in the extracted folder. Copy the 32-letter ID for **Hey, ChatGPT (Desktop Link)**.
4. Run **`setup/Register-Chrome-Link.cmd`** and paste that ID. Review the prompt and enter `YES`. Registration affects the current Windows user and needs no administrator access. Reload the extension in Chrome.
5. Open **`Hey-ChatGPT.exe`** and click **Start listening**. If asked for a helper folder, choose the folder containing `.venv`, `probe.py`, and `model`. You do not have to open a command prompt or configure another pairing token.
6. Click the Chrome extension icon, open its settings, enter the URL of an **existing** ChatGPT conversation, give it a wake phrase, and save. The Desktop Link extension does not import settings from the older browser-only extension.

## First dictation

Keep Chrome open with a signed-in, non-incognito window. Close the extension settings tab and hide the app in the tray if you like.

Say the wake phrase. Wait for the chime before speaking. A short pause finishes the segment without sending it. Say the phrase again to continue dictating. To use voice sending, set a separate send phrase and use it when the draft is ready. You can also enable single-segment auto-send in the extension settings.

If a wake phrase is unreliable, try a longer, more distinctive one that uses Mandarin or English words in the model’s dictionary. Mixed-language phrases are supported. Out-of-dictionary English words, digits, emoji, and unsupported punctuation are rejected. Avoid short send phrases.

The app does not switch to a different conversation if a target redirects, requires sign-in, or is open in multiple matching tabs. It does not replay sends after reconnecting.

## Upgrade or remove

- **Upgrade from 0.3.0:** If the old version works, you can keep its `VoiceRoutes-Bridge/en.phone` when updating in place. For a new app folder, either copy that file to `model/en.phone` in the existing helper folder or prepare a new helper using the setup command. If you move the app or the extension ID changes, unregister the old connection and register the new one.
- **Pause or quit:** Use the tray menu. Closing the app window only hides it.
- **Remove:** Quit the app, run **`setup/Unregister-Chrome-Link.cmd`**, confirm with `YES`, then disable or remove Desktop Link at `chrome://extensions`. The old helper and browser-only extension are left intact.

## Build from source

On Windows x64 with Go 1.27.4 or later, run `desktop/BUILD.ps1` to build the desktop app and native host. In `setup/source`, run `go build -trimpath -o ../Chrome-Link.exe .` to build the registration tool. Then run `python build-bundle.py` from the repository root to assemble the ZIP.

The tray uses [MyGo](https://github.com/egoist/mygo). The Chrome extension uses Native Messaging to reach the app, and wake-word recognition uses [Sherpa-ONNX](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html). See [third-party notices](../VoiceRoutes-Bridge/NOTICE.txt) for model provenance and distribution details.

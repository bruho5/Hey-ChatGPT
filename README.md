# Hey, ChatGPT

[简体中文](README-中文.md)

**[Download for Windows x64](https://github.com/bruho5/Hey-ChatGPT/releases)**: choose `Hey-ChatGPT-MyGo-0.3.1-Windows-x64.zip` under Assets.

Open a saved ChatGPT conversation with a custom wake phrase, dictate into it, and optionally send the draft by voice. The MyGo app runs in the Windows tray. After setup, you do not need a command prompt or an open Chrome extension settings tab.

## Requirements

- Windows x64, Chrome with a normal (not incognito) window, and a signed-in ChatGPT account.
- An initialized `VoiceRoutes-KWS-Windows` helper folder. The MyGo archive includes the helper setup and the updated wake-word script, **not** Python, Sherpa-ONNX, the model, or its English pronunciation lexicon. If you already have a working runtime and lexicon, you can keep using them. Otherwise install 64-bit Python 3.11 with its Windows `py` launcher, then run the bundled **VoiceRoutes-KWS-Windows/Prepare-Helper.cmd** once. Setup downloads the pinned Sherpa model and lexicon from their publisher and installs checksum-pinned Windows wheels from PyPI into a local `.venv`. Runtime wake-word recognition does not use the internet.

## Set up

1. Extract the full MyGo archive to a location you intend to keep. Exit the old command-line helper if it is running, and temporarily disable the older browser-only extension to avoid running both versions at once.
2. Open `chrome://extensions`. Turn on **Developer mode**, select **Load unpacked**, and pick the package’s **VoiceRoutes-Web** folder. Copy the 32-letter ID shown for **Hey, ChatGPT (Desktop Link)**.
3. Run **setup/Register-Chrome-Link.cmd**. Paste that ID, review the prompt, and enter `YES`. This registers the connector for your current Chrome user only and does not require administrator access. Return to Chrome and reload the extension. If you move the app or change the unpacked extension ID, unregister the old link first and register again.
4. Open **Hey-ChatGPT.exe**, choose the helper folder containing `.venv`, `probe.py`, and `model`, then click **Start listening**. The app uses the prepared environment and model without overwriting them. No token copying or separate command window is needed.
5. Open the extension’s settings, add the URL of an **existing** ChatGPT conversation, pair it with a custom wake phrase, and save. This extension is separate from the old browser-only version, so the old routes are not imported automatically.

**Upgrading from 0.3.0:** if your previous app already works, either keep the old `VoiceRoutes-Bridge/en.phone` when upgrading in place, or copy it to `model/en.phone` inside your existing helper folder. Otherwise run the bundled helper setup and select its folder. The new app also checks for an existing lexicon next to its bridge script as a compatibility fallback.

## Use it

- The Chrome settings tab can be closed. Closing the app window hides it in the Windows tray. Leave Chrome open and signed in with a normal window. You do not need to pre-open the chosen chat.
- Say the wake phrase. Wait for the chime confirming that ChatGPT dictation has started, then speak. A short pause ends the segment and leaves a draft. Say the same wake phrase to continue dictating.
- Sending is separate and automatic sending is off by default. Check the draft and say the send phrase, or turn on the optional single-segment auto-send setting if you want it.
- **If a phrase with “ChatGPT” does not trigger reliably, try a different custom phrase**, such as **Hey 莫**. Short phrases can wake accidentally; for everyday use try a more distinctive phrase like **Hey 莫去写作**, and especially avoid short send phrases. Mandarin and known English words can be mixed in either order, with or without spaces where scripts meet, for example **莫 open 写作**. Out-of-dictionary English words, digits, emoji, and unsupported punctuation are rejected when the phrase is checked.
- Switch the app between Simplified Chinese and English using its **Language** menu. Chrome has its own **Settings → Appearance** controls. Neither changes the words you set as wake phrases.

Wake-word recognition runs locally. Once activated, the spoken message is transcribed by ChatGPT’s own dictation. If the target changes, login expires, duplicate tabs prevent a unique match, or the connection drops, the app will not choose a different chat or replay a send after reconnecting.

## Disable or remove

Pause or quit from the tray. Run **setup/Unregister-Chrome-Link.cmd**, confirm with `YES`, and disable or remove **Desktop Link** at `chrome://extensions`. The original helper and browser-only extension are left intact. This is an unsigned, unofficial app, not an OpenAI product.

## Implementation and build

The Windows tray app is built with [MyGo](https://github.com/egoist/mygo). Chrome talks to it using Native Messaging, and wake phrases use [Sherpa-ONNX keyword spotting](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html). See [Third-party notices](VoiceRoutes-Bridge/NOTICE.txt). To build the Windows app and native host from source, run `desktop/BUILD.ps1` with Go 1.27.4 or later. On a Windows x64 build machine, run `go build -trimpath -o ../Chrome-Link.exe .` from `setup/source`. Then run `python build-bundle.py` from the repository root to assemble the release ZIP.

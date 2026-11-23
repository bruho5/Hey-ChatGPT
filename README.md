# Hey, ChatGPT

A Windows tray app that opens a saved ChatGPT conversation when you say a custom wake phrase. Wait for the chime, then speak to dictate a draft in that conversation.

**[Download for Windows x64](https://github.com/bruho5/Hey-ChatGPT/releases/download/v0.3.1/Hey-ChatGPT-MyGo-0.3.1-Windows-x64.zip)** · [Release notes](https://github.com/bruho5/Hey-ChatGPT/releases/tag/v0.3.1) · [简体中文](README-中文.md)

Keep a regular Chrome window open and signed in to ChatGPT. You can close the extension settings tab, hide the app in the tray, and leave the target conversation closed until you need it.

## Get started

1. **Prepare the helper.** Extract the ZIP. On first setup, install **64-bit Python 3.11** with the Windows `py` launcher, then run `VoiceRoutes-KWS-Windows/Prepare-Helper.cmd`. It downloads and verifies the Sherpa-ONNX assets and installs pinned dependencies in a local environment.
2. **Connect Chrome.** Load the unpacked `VoiceRoutes-Web` extension and register its ID with the included connector. Follow the [Windows setup guide](docs/setup.md) for the exact steps.
3. **Add a conversation.** Open `Hey-ChatGPT.exe` and start listening. In the extension settings, assign a phrase to an existing ChatGPT conversation. Say it, wait for the chime, then dictate.

## Dictate and send

A pause leaves the text as a draft. Say the same wake phrase to add another segment. A separate send phrase can submit the draft; auto-send is off by default.

Wake phrases can mix Mandarin and English words that are in the helper’s dictionary. If a phrase is unreliable, try a longer, more distinctive one. It does not have to include “ChatGPT.”

Wake phrases are recognized locally. Dictation itself uses ChatGPT in Chrome. The desktop app and Chrome extension both offer English and Simplified Chinese. This is an unsigned, unofficial app.

[Setup, upgrade, and removal](docs/setup.md) · [Build from source](docs/setup.md#build-from-source)

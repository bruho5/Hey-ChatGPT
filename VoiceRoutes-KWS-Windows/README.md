# Hey, ChatGPT wake-word helper setup

This folder contains setup source only. It does not redistribute the model, its lexicon, Python, or any wheels. See [Third-party notices](NOTICE.txt).

1. Install 64-bit Python 3.11 with the Windows `py` launcher.
2. Extract the folder to a location you intend to keep, then run **Prepare-Helper.cmd** while online. It creates `.venv`, installs only the pinned Windows wheels from PyPI, and downloads and checks the pinned official Sherpa-ONNX model and lexicon.
3. Open **Hey-ChatGPT.exe**, choose this folder if needed, and start listening. The setup command is not needed again for normal use.

简体中文：安装 64 位 Python 3.11 和 Windows `py` 启动器，解压本文件夹并联网运行 **Prepare-Helper.cmd**。它会创建本地 `.venv` 并校验下载；然后在 **Hey-ChatGPT.exe** 里选择本文件夹。日常不需要再运行准备程序。

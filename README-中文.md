# Hey, ChatGPT

一款 Windows 托盘应用。说出自定义唤醒词，就能打开已保存的 ChatGPT 会话；听到提示音后说话，即可在该会话中输入草稿。

**[下载 Windows x64 版](https://github.com/bruho5/Hey-ChatGPT/releases/download/v0.3.1/Hey-ChatGPT-MyGo-0.3.1-Windows-x64.zip)** · [发布说明](https://github.com/bruho5/Hey-ChatGPT/releases/tag/v0.3.1) · [English](README.md)

保持 Chrome 的普通窗口打开，并登录 ChatGPT。应用可以收进托盘，扩展设置页可以关闭，目标会话也不用提前打开。

## 开始使用

1. **准备唤醒助手。** 解压 ZIP。首次使用需安装 **64 位 Python 3.11** 和 Windows 的 `py` 启动器，再运行 `VoiceRoutes-KWS-Windows/Prepare-Helper.cmd`。它会下载并校验 Sherpa-ONNX 资源，把指定版本的依赖装进本地环境。
2. **连接 Chrome。** 加载解压后的 `VoiceRoutes-Web` 扩展，使用包内连接器登记扩展 ID。具体步骤见 [Windows 设置指南](docs/setup-zh-CN.md)。
3. **添加会话。** 打开 `Hey-ChatGPT.exe` 并开始监听。在扩展设置中，为一个已有的 ChatGPT 会话设定唤醒词。说出口令，听到提示音后再说正文。

## 听写和发送

停顿后，应用会把这段内容留作草稿。再次说同一条唤醒词就能续录。需要提交时，可以说独立的发送口令；自动发送默认关闭。

唤醒词支持普通话和词典内的英文混用。如果识别不稳定，可以试一个更长、更容易区分的口令，不必包含「ChatGPT」。

唤醒词在本机识别，正文由 Chrome 中的 ChatGPT 听写转录。桌面应用和 Chrome 扩展都支持中文与英文界面。本应用未签名，也不是 OpenAI 官方产品。

[设置、升级与移除](docs/setup-zh-CN.md) · [从源码构建](docs/setup-zh-CN.md#从源码构建)

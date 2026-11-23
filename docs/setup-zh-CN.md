# 在 Windows 上设置 Hey, ChatGPT

[English](setup.md) · [返回 README](../README-中文.md)

## 首次设置

1. 将 [Windows x64 ZIP](https://github.com/bruho5/Hey-ChatGPT/releases/download/v0.3.1/Hey-ChatGPT-MyGo-0.3.1-Windows-x64.zip) 完整解压到以后不会随意移动的文件夹。先退出旧命令行助手，并暂时停用旧浏览器版扩展，避免两个版本同时工作。
2. 安装 **64 位 Python 3.11** 和 Windows 的 `py` 启动器。联网运行 **`VoiceRoutes-KWS-Windows/Prepare-Helper.cmd`**。它会在该文件夹创建 `.venv`，从 PyPI 安装已锁定校验值的 Windows 依赖，并从上游下载、校验 Sherpa-ONNX 模型和英语发音词表。ZIP 不附带 Python、运行库、模型或词表。准备完成后，唤醒词识别不需要联网。
3. 在 Chrome 打开 `chrome://extensions`，打开「开发者模式」，点「加载已解压的扩展程序」，选择解压目录下的 **`VoiceRoutes-Web`**。复制 **Hey, ChatGPT (Desktop Link)** 的 32 字母扩展 ID。
4. 运行 **`setup/Register-Chrome-Link.cmd`**，粘贴该 ID，检查提示后输入 `YES`。登记只对当前 Windows 用户生效，不需要管理员权限。回到 Chrome 重新加载扩展。
5. 打开 **`Hey-ChatGPT.exe`**，点「开始监听」。如果提示选择助手文件夹，选择包含 `.venv`、`probe.py` 和 `model` 的那一层。不需要另外打开命令行或复制配对码。
6. 点 Chrome 扩展图标打开设置，填入一个**已有**的 ChatGPT 会话链接和对应的唤醒词，并保存。Desktop Link 不会自动导入旧浏览器版的设置。

## 第一次听写

保持 Chrome 打开且登录，并保留一个普通窗口。扩展设置页可以关，桌面窗口也可以收进托盘。

说出唤醒词，听到提示音后再说正文。短暂停顿会结束当前段落，内容留作草稿。再次说同一条口令可继续听写。要用语音发送，先设置独立的发送口令，等草稿就绪后再说；也可以在扩展设置中启用单段自动发送。

如果唤醒识别不稳定，可以换成更长、更容易区分的普通话口令或词典内英文口令，也可以中英混搭。词典外的英文、数字、表情和不支持的标点会被拒绝。尽量别用太短的发送口令。

目标会话发生跳转、需要登录，或有多个匹配的标签页时，应用不会转去操作其他会话。重新连接后也不会补发旧指令。

## 升级或移除

- **从 0.3.0 升级：** 如果原版已经能用，原地更新时保留 `VoiceRoutes-Bridge/en.phone`。换了新目录，可以把原词表复制到旧助手的 `model/en.phone`，或按首次设置重新准备助手。移动应用或更换扩展 ID 后，需先取消旧登记，再重新登记。
- **暂停或退出：** 使用托盘菜单。关掉应用窗口只会隐藏。
- **移除：** 退出应用，运行 **`setup/Unregister-Chrome-Link.cmd`** 并输入 `YES`。然后在 `chrome://extensions` 停用或移除 Desktop Link；旧助手和旧浏览器版扩展不受影响。

## 从源码构建

在装有 Go 1.27.4 或更高版本的 Windows x64 上运行 `desktop/BUILD.ps1`，构建桌面应用和本机连接器。在 `setup/source` 目录运行 `go build -trimpath -o ../Chrome-Link.exe .`，构建登记程序。在仓库根目录运行 `python build-bundle.py`，生成发布 ZIP。

托盘应用使用 [MyGo](https://github.com/egoist/mygo)，Chrome 扩展使用 Native Messaging 连接桌面应用，唤醒词通过 [Sherpa-ONNX](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html) 识别。[第三方说明](../VoiceRoutes-Bridge/NOTICE.txt)记录了模型来源与分发方式。

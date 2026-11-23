# Hey, ChatGPT · MyGo 托盘版（Windows x64）

[English](README.md)

**[下载 Windows x64 版](https://github.com/bruho5/Hey-ChatGPT/releases)**：在发布页的 Assets 中选 `Hey-ChatGPT-MyGo-0.3.1-Windows-x64.zip`。

安装后日常打开 **Hey-ChatGPT.exe** 并点「开始监听」，不用开命令行。关掉 App 窗口会收进托盘；Chrome 的扩展设置页也可以关掉。Chrome 本身需保持开启，有普通窗口并已登录；目标会话不用预先打开。

## 使用条件

- Windows x64、Chrome 普通窗口（非无痕），并已登录 ChatGPT。
- 一个已配置好的 `VoiceRoutes-KWS-Windows` 文件夹。主包附带本地助手的准备程序和新版唤醒脚本，**不附带 Python、Sherpa-ONNX 运行库、模型或英语发音词表**。已有能用的助手和词表，就可以继续沿用。首次使用需安装 64 位 Python 3.11 及 Windows 的 `py` 启动器，再双击包里的 **VoiceRoutes-KWS-Windows/Prepare-Helper.cmd**。准备程序从官方地址下载固定版本模型和词表，并从 PyPI 安装已锁定 SHA-256 的 Windows 依赖到本地 `.venv`。只在准备阶段联网，唤醒识别本身不联网。

## 第一次设置

1. 将 ZIP 完整解压到准备长期存放的位置。不要在 ZIP 预览里运行。先**退出旧的黑色 Windows 助手窗口**，否则两版会争用本机端口。旧的浏览器版建议保留但先在 `chrome://extensions` 暂时停用，避免两套同时工作。
2. 在 Chrome 打开 `chrome://extensions`，启用开发者模式，点「加载已解压的扩展程序」，选包内 **VoiceRoutes-Web**。复制 **Hey, ChatGPT (Desktop Link)** 的扩展程序 ID（32 个小写字母）。
3. 双击包里 **setup/Register-Chrome-Link.cmd**，粘贴这一个 ID，确认后输入 `YES`。它只在当前 Windows 用户的 Chrome 下登记这个本机连接器，不用管理员权限；登记成功后回 Chrome 点扩展卡片的「重新加载」。换了存放位置或 Chrome 扩展 ID 后，按卸载步骤删除旧登记，再重新登记。
4. 打开 **Hey-ChatGPT.exe**。在应用里选择你原先跑通的 **VoiceRoutes-KWS-Windows** 文件夹（必须已经配好，如未配好先运行准备程序）（选包含 `.venv`、`probe.py` 和 `model` 的那层），启动监听。应用会用这一份 Python 和模型运行包内的新口令代码，不会覆盖原助手。不需要自己启动 CMD 或复制配对码。
5. 点 Chrome 扩展图标，打开右上角设置，填入并保存一个**已存在**的 ChatGPT 会话 URL 和它的口令。托盘版是独立扩展，旧版设置不会自动迁移。

**从 0.3.0 升级：**原版已能运行的话，原地覆盖时保留旧的 `VoiceRoutes-Bridge/en.phone` 即可；换新目录的话，也可以把这个文件复制到原助手文件夹的 `model/en.phone`。否则运行包内的准备程序，再选新助手文件夹。新版仍会兼容读取旧版放在唤醒脚本同级的词表。

## 试跑

- 保持 Chrome 已登录、有一个普通窗口。**关闭扩展设置页**，把 App 窗口关到托盘。确保目标会话没有预先打开。
- 说唤醒口令。只有找到并启动指定会话的官方听写才响提示音；听到再说正文。等两秒左右，当前段落会留在草稿，喊相同口令可续录。
- 默认不会自动发送；确认草稿后再说独立的发送口令。可在设置里启用单段自动发送。页面跳转、登录过期、多份重复会话或连接断开时，不会改在其他会话里录或重试发送。
- **如果带「ChatGPT」的口令不太好唤醒，试着换一个自定义口令**，例如「Hey 莫」。短口令更容易误触发；日常可用辨识度更高的「Hey 莫去写作」，发送口令尤其建议长一点。普通话和词典里的英文可任意顺序混搭，汉字和英文字母交界不用空格，例如「莫 open 写作」。英文不在词典，或带数字、表情、未支持的标点时，会提示修改。
- 桌面 App 右上角「语言」可在简体中文与 English 之间切换。Chrome 扩展有独立的「设置 → 外观」。两处切换都不改动口令。
- 口令由本机助手识别；确认启动听写后，正文仍由 ChatGPT 的官方听写转录。关掉 Chrome 时无法操作会话，不会积压并补发指令。

## 停用 / 回退

托盘菜单可暂停监听或退出。关闭 App 后可用 **setup/Unregister-Chrome-Link.cmd** 删除这一个登记，按提示输入 `YES`；再在扩展页停用或移除 **Desktop Link**。原浏览器版和原助手未被本包覆盖，可以重新启用。此包不是 OpenAI 官方产品，也未签名。


## 实现与构建

Windows 托盘 App 用 [MyGo](https://github.com/egoist/mygo) 构建；Chrome 扩展通过 Native Messaging 连接本机 App；唤醒词使用 [Sherpa-ONNX](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html)。[第三方说明](VoiceRoutes-Bridge/NOTICE.txt)。源码构建需 Go 1.27.4 或更高版本；运行 `desktop/BUILD.ps1` 构建主程序和本机连接器。使用 Windows x64 构建时，在 `setup/source` 内运行 `go build -trimpath -o ../Chrome-Link.exe .` 生成安装连接器，再从仓库根目录运行 `python build-bundle.py` 生成发布包。

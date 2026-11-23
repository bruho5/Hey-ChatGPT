package main

import "strings"

// Language is separate from the Chrome extension's appearance and phrase settings.
func validLanguage(lang string) bool { return lang == "zh" || lang == "en" }

var english = map[string]string{
	"缺少英语发音词表。请运行 VoiceRoutes-KWS-Windows 内的 Prepare-Helper.cmd，再选择该文件夹。": "The English lexicon is missing. Run Prepare-Helper.cmd in VoiceRoutes-KWS-Windows, then select that folder.",
	"选择已配置的唤醒助手文件夹":                          "Choose the existing wake-word helper folder",
	"请选择含 .venv、probe.py 和 model 的原唤醒助手文件夹。": "Choose the existing helper folder containing .venv, probe.py and model.",
	"请先暂停监听。":                                "Pause listening first.",
	"助手文件夹已选，点击开始监听。":                        "Helper folder selected. Click Start listening.",
	"路径本次有效，但无法保存。":                          "The folder is valid for this session, but its path could not be saved.",
	"正在启动本机助手…":                              "Starting the local helper…",
	"无法启动：":                                  "Could not start: ",
	"选中的目录缺少 .venv、probe.py 或 model。请选择原来能运行唤醒助手的文件夹。": "The selected folder is missing .venv, probe.py or model. Choose the folder where the wake-word helper already works.",
	"本安装包缺少新版助手脚本；请重新解压，不会改用旧版。":                       "The updated helper script is missing. Extract the whole package again. The app will not fall back to the old version.",
	"启动超时。确认旧助手已关闭、麦克风可用。":                             "Startup timed out. Check that the old helper is closed and the microphone is available.",
	"本机助手已就绪。": "The local helper is ready.",
	"助手已退出。请确认旧助手已关闭、环境和麦克风可用。": "The helper stopped. Check that the old helper is closed and the environment and microphone are available.",
	"已暂停监听。":            "Listening paused.",
	"Chrome 已连接，等待口令。":  "Chrome connected. Waiting for a wake phrase.",
	"目标会话正在听写。":         "The target conversation is transcribing.",
	"草稿已就绪。":            "Draft ready.",
	"已发送到目标会话。":         "Sent to the target conversation.",
	"Chrome 正在处理…":      "Chrome is working…",
	"Chrome 尚未准备好。":     "Chrome isn’t ready yet.",
	"已暂停。开始监听后才会开启麦克风。": "Paused. The microphone turns on only when you start listening.",
	"托盘无法启动。本次不会开启监听。":  "The tray could not start. Listening will remain off.",
	"打开设置":              "Open settings",
	"开始监听":              "Start listening",
	"暂停监听":              "Pause listening",
	"退出":                "Quit",
	"无法启动专用 Chrome 通道。请关闭其他副本后重试。": "The private Chrome link could not start. Close other copies and try again.",
	"语言已切换，但无法保存。":                 "The language changed for this session, but could not be saved.",
}

func localized(lang, message string) string {
	if lang != "en" {
		return message
	}
	if translation, exists := english[message]; exists {
		return translation
	}
	const prefix = "无法启动："
	if strings.HasPrefix(message, prefix) {
		return english[prefix] + localized(lang, strings.TrimPrefix(message, prefix))
	}
	return message
}

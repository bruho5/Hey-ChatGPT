package main

import (
	"strings"
	"testing"
)

func TestDesktopLanguageAndStatus(t *testing.T) {
	for _, lang := range []string{"zh", "en"} {
		if !validLanguage(lang) {
			t.Errorf("valid language rejected: %v", lang)
		}
	}
	if validLanguage("en-US") {
		t.Fatal("non-allowlisted locale accepted")
	}
	if localized("zh", "打开设置") != "打开设置" || localized("en", "打开设置") != "Open settings" {
		t.Fatal("tray locale mismatch")
	}
	msg := localized("en", "无法启动：缺少英语发音词表。请运行 VoiceRoutes-KWS-Windows 内的 Prepare-Helper.cmd，再选择该文件夹。")
	if !strings.HasPrefix(msg, "Could not start: The English lexicon is missing") {
		t.Errorf("nested status: %q", msg)
	}
}

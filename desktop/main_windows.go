package main

import (
	"bytes"
	"embed"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"heychatgpt/internal/pipe"
	"heychatgpt/internal/protocol"
)

//go:embed web
var assets embed.FS

type view struct {
	Folder   string `json:"folder"`
	Message  string `json:"message"`
	Chrome   string `json:"chrome"`
	Running  bool   `json:"running"`
	Busy     bool   `json:"busy"`
	Ready    bool   `json:"ready"`
	Language string `json:"language"`
}

type Desktop struct {
	mu         sync.Mutex
	folder     string
	message    string
	chrome     string
	running    bool
	stopping   bool
	shutdown   bool
	token      string
	helper     *helperProcess
	changed    chan struct{}
	chromeConn net.Conn
	listen     net.Listener
	bridgeDir  string
	configFile string
	localeFile string
	language   string
	lastCue    time.Time
	trayReady  bool
}

func (d *Desktop) Status() view {
	d.mu.Lock()
	defer d.mu.Unlock()
	return view{
		Folder: d.folder, Message: localized(d.language, d.message), Chrome: localized(d.language, d.chrome),
		Running: d.token != "", Busy: d.running && d.token == "", Ready: d.listen != nil && d.trayReady,
		Language: d.language,
	}
}

func (d *Desktop) SetLanguage(language string) (view, error) {
	if !validLanguage(language) {
		return d.Status(), nil
	}
	d.mu.Lock()
	d.language = language
	file := d.localeFile
	d.mu.Unlock()
	if file != "" {
		err := os.MkdirAll(filepath.Dir(file), 0700)
		if err == nil {
			err = os.WriteFile(file, []byte(language), 0600)
		}
		if err != nil {
			return d.Status(), errors.New(localized(language, "语言已切换，但无法保存。"))
		}
	}
	return d.Status(), nil
}

func (d *Desktop) ChooseFolder() (view, error) {
	s := d.Status()
	files, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Title: localized(s.Language, "选择已配置的唤醒助手文件夹"), Directory: true, DefaultPath: s.Folder})
	if err != nil || len(files) != 1 {
		return d.Status(), err
	}
	abs, err := filepath.Abs(files[0])
	if err != nil {
		return d.Status(), err
	}
	if !validRuntime(abs) {
		return d.Status(), errors.New(localized(s.Language, "请选择含 .venv、probe.py 和 model 的原唤醒助手文件夹。"))
	}
	d.mu.Lock()
	if d.running || d.shutdown {
		d.mu.Unlock()
		return d.Status(), errors.New(localized(s.Language, "请先暂停监听。"))
	}
	d.folder = abs
	d.message = "助手文件夹已选，点击开始监听。"
	cfg := d.configFile
	if cfg != "" {
		if err = os.MkdirAll(filepath.Dir(cfg), 0700); err == nil {
			err = os.WriteFile(cfg, []byte(abs), 0600)
		}
	}
	if err != nil {
		d.message = "路径本次有效，但无法保存。"
	}
	d.mu.Unlock()
	return d.Status(), nil
}

func (d *Desktop) signalLocked() {
	select {
	case d.changed <- struct{}{}:
	default:
	}
}

func (d *Desktop) StartListening() view {
	d.mu.Lock()
	if d.running || d.shutdown || d.listen == nil || !d.trayReady {
		d.mu.Unlock()
		return d.Status()
	}
	d.running = true
	d.stopping = false
	d.message = "正在启动本机助手…"
	folder := d.folder
	d.mu.Unlock()
	go d.start(folder)
	return d.Status()
}

func (d *Desktop) start(folder string) {
	p, output, err := startHelper(folder, d.bridgeDir)
	d.mu.Lock()
	if err != nil {
		d.running = false
		d.stopping = false
		d.message = "无法启动：" + err.Error()
		d.mu.Unlock()
		return
	}
	d.helper = p
	if d.stopping || d.shutdown {
		p.stop()
	}
	d.mu.Unlock()

	timeout := time.AfterFunc(20*time.Second, func() {
		d.mu.Lock()
		defer d.mu.Unlock()
		if d.helper == p && d.token == "" && !d.stopping && !d.shutdown {
			d.stopping = true
			d.message = "启动超时。确认旧助手已关闭、麦克风可用。"
			p.stop()
		}
	})
	watchHelper(p, output, func(token string) {
		d.mu.Lock()
		defer d.mu.Unlock()
		if d.helper == p && !d.stopping && !d.shutdown {
			timeout.Stop()
			d.token = token
			d.message = "本机助手已就绪。"
			d.signalLocked()
		}
	}, func() {
		timeout.Stop()
		d.mu.Lock()
		defer d.mu.Unlock()
		if !d.stopping && !d.shutdown {
			d.message = "助手已退出。请确认旧助手已关闭、环境和麦克风可用。"
		}
		d.helper, d.token, d.running, d.stopping, d.chrome = nil, "", false, false, ""
		d.signalLocked()
	})
}

func (d *Desktop) PauseListening() view {
	d.mu.Lock()
	d.stopping = d.running
	d.token, d.chrome = "", ""
	d.message = "已暂停监听。"
	d.signalLocked()
	if p := d.helper; p != nil {
		p.stop()
	}
	d.mu.Unlock()
	return d.Status()
}

func (d *Desktop) stop() {
	d.mu.Lock()
	d.shutdown = true
	d.token = ""
	d.signalLocked()
	if d.helper != nil {
		d.helper.stop()
	}
	if d.chromeConn != nil {
		_ = d.chromeConn.Close()
	}
	l := d.listen
	d.listen = nil
	d.mu.Unlock()
	if l != nil {
		_ = l.Close()
	}
}

func (d *Desktop) acceptConnections(l net.Listener) {
	for {
		c, err := l.Accept()
		if err != nil {
			return
		}
		if pipe.CheckPeer(c, true) != nil {
			_ = c.Close()
			continue
		}
		d.mu.Lock()
		if d.chromeConn != nil || d.shutdown {
			d.mu.Unlock()
			_ = c.SetWriteDeadline(time.Now().Add(150 * time.Millisecond))
			_ = protocol.Write(c, protocol.Status(""))
			_ = c.Close()
			continue
		}
		d.chromeConn = c
		d.signalLocked()
		d.mu.Unlock()
		go d.serveChrome(c)
	}
}

func (d *Desktop) serveChrome(c net.Conn) {
	defer func() {
		d.mu.Lock()
		if d.chromeConn == c {
			d.chromeConn, d.chrome = nil, ""
		}
		d.mu.Unlock()
		_ = c.Close()
	}()
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer c.Close()
		for {
			var m protocol.Command
			if protocol.Read(c, &m) != nil || !m.IsValid() {
				return
			}
			d.applyCommand(c, m)
		}
	}()
	previous := protocol.State{}
	for {
		select {
		case <-done:
			return
		case <-d.changed:
			d.mu.Lock()
			s := protocol.Status(d.token)
			d.mu.Unlock()
			if s != previous {
				if c.SetWriteDeadline(time.Now().Add(time.Second)) != nil || protocol.Write(c, s) != nil {
					return
				}
				previous = s
			}
		}
	}
}

func (d *Desktop) applyCommand(c net.Conn, m protocol.Command) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.chromeConn != c || d.token == "" || d.shutdown {
		return
	}
	switch m.Type {
	case "cue":
		now := time.Now()
		if now.Sub(d.lastCue) >= 750*time.Millisecond {
			d.lastCue = now
			playCue()
		}
	case "status":
		// Only a short allowlisted mode reaches the settings window.
		switch m.Message {
		case "idle":
			d.chrome = "Chrome 已连接，等待口令。"
		case "recording":
			d.chrome = "目标会话正在听写。"
		case "ready":
			d.chrome = "草稿已就绪。"
		case "sent":
			d.chrome = "已发送到目标会话。"
		case "starting", "stopping", "sending":
			d.chrome = "Chrome 正在处理…"
		case "offline", "disconnected", "paused":
			d.chrome = "Chrome 尚未准备好。"
		}
	}
}

func trayIcon() []byte {
	im := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	for y := 2; y < 30; y++ {
		for x := 2; x < 30; x++ {
			if (x-16)*(x-16)+(y-16)*(y-16) <= 180 {
				im.SetNRGBA(x, y, color.NRGBA{18, 124, 110, 255})
			}
			if (x >= 14 && x <= 17 && y >= 8 && y <= 18) ||
				(x >= 10 && x <= 21 && y >= 16 && y <= 19 && (x <= 12 || x >= 19)) ||
				(x >= 12 && x <= 19 && y >= 20 && y <= 21) ||
				(x >= 15 && x <= 16 && y >= 22 && y <= 25) {
				im.SetNRGBA(x, y, color.NRGBA{235, 253, 247, 255})
			}
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, im)
	return b.Bytes()
}

func main() {
	mygo.App.SetName("Hey, ChatGPT")
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	executable, err := os.Executable()
	if err != nil {
		return
	}
	bundle := filepath.Dir(executable)
	d := &Desktop{
		changed:   make(chan struct{}, 1),
		message:   "已暂停。开始监听后才会开启麦克风。",
		bridgeDir: filepath.Join(bundle, "VoiceRoutes-Bridge"),
		language:  "zh",
	}
	if dir, err := mygo.App.Path(mygo.PathUserData); err == nil {
		d.configFile = filepath.Join(dir, "helper-folder.txt")
		d.localeFile = filepath.Join(dir, "language.txt")
		if saved, err := os.ReadFile(d.localeFile); err == nil && len(saved) <= 8 {
			if language := strings.TrimSpace(string(saved)); validLanguage(language) {
				d.language = language
			}
		}
		if saved, err := os.ReadFile(d.configFile); err == nil && len(saved) <= 32768 {
			if folder := strings.TrimSpace(string(saved)); validRuntime(folder) {
				d.folder = folder
			}
		}
	}
	if d.folder == "" {
		for _, folder := range []string{bundle, filepath.Join(bundle, "VoiceRoutes-KWS-Windows")} {
			if validRuntime(folder) {
				d.folder = folder
				break
			}
		}
	}
	mygo.Bind(d)
	web, _ := fs.Sub(assets, "web")
	mygo.SetFrontend(web)
	var win *mygo.Window
	var quitting bool
	show := func() {
		if win != nil {
			win.Show()
			win.Restore()
			win.Focus()
		}
	}
	mygo.App.OnSecondInstance(func([]string, string) { show() })
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) {
		quitting = true
		d.stop()
	})
	mygo.App.WhenReady(func() {
		win = mygo.NewWindow(mygo.WindowOptions{Title: "Hey, ChatGPT", URL: "/", Width: 535, Height: 500})
		win.Page().SetWindowOpenHandler(func(mygo.WindowOpenRequest) *mygo.WindowOptions { return nil })
		win.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
			if e.URL != "http://mygo.localhost" && !strings.HasPrefix(e.URL, "http://mygo.localhost/") {
				e.PreventDefault()
			}
		})
		tray, err := mygo.NewTray(mygo.TrayOptions{ID: "heychatgpt", Icon: trayIcon(), ToolTip: "Hey, ChatGPT"})
		if err != nil {
			d.mu.Lock()
			d.message = "托盘无法启动。本次不会开启监听。"
			d.mu.Unlock()
			return
		}
		d.mu.Lock()
		d.trayReady = true
		d.mu.Unlock()
		tray.OnClick(show)
		tray.OnRightClick(func() {
			s := d.Status()
			tray.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
				{Label: localized(s.Language, "打开设置"), Click: func(*mygo.MenuItem, *mygo.Window) { show() }},
				{Label: localized(s.Language, "开始监听"), Disabled: s.Running || s.Busy || !s.Ready, Click: func(*mygo.MenuItem, *mygo.Window) {
					if !validRuntime(s.Folder) {
						show()
						return
					}
					d.StartListening()
				}},
				{Label: localized(s.Language, "暂停监听"), Disabled: !s.Running && !s.Busy, Click: func(*mygo.MenuItem, *mygo.Window) { d.PauseListening() }},
				{Label: localized(s.Language, "退出"), Click: func(*mygo.MenuItem, *mygo.Window) { mygo.App.Quit() }},
			}))
			tray.PopUpMenu()
			tray.SetMenu(nil)
		})
		win.OnClose(func(e *mygo.CloseEvent) {
			if !quitting {
				e.PreventDefault()
				win.Hide()
			}
		})
		l, err := pipe.Listen()
		if err != nil {
			d.mu.Lock()
			d.message = "无法启动专用 Chrome 通道。请关闭其他副本后重试。"
			d.mu.Unlock()
			return
		}
		d.mu.Lock()
		d.listen = l
		d.mu.Unlock()
		go d.acceptConnections(l)
	})
	defer d.stop()
	_ = mygo.App.Run()
}

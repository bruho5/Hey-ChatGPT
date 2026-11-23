package main

import (
	"bufio"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
	"heychatgpt/internal/protocol"
)

const runBridge = "import runpy,sys; root,script=sys.argv[1:3]; sys.path.insert(0,root); sys.argv=[script]; runpy.run_path(script,run_name='__main__')"
const modelStem = "epoch-13-avg-2-chunk-16-left-64"

func hasFiles(root string, paths ...string) bool {
	if root == "" {
		return false
	}
	for _, p := range paths {
		info, err := os.Stat(filepath.Join(root, p))
		if err != nil || !info.Mode().IsRegular() {
			return false
		}
	}
	return true
}

func validRuntime(path string) bool {
	return filepath.IsAbs(path) && hasFiles(path,
		`.venv\Scripts\python.exe`, "probe.py", "model/tokens.txt",
		"model/encoder-"+modelStem+".int8.onnx", "model/decoder-"+modelStem+".onnx",
		"model/joiner-"+modelStem+".int8.onnx")
}

type helperProcess struct {
	process windows.Handle
	job     windows.Handle
	once    sync.Once
}

func (p *helperProcess) stop() { p.once.Do(func() { _ = windows.CloseHandle(p.job) }) }

func startHelper(runtimeDir, bridgeDir string) (*helperProcess, io.ReadCloser, error) {
	if !validRuntime(runtimeDir) {
		return nil, nil, errors.New("选中的目录缺少 .venv、probe.py 或 model。请选择原来能运行唤醒助手的文件夹。")
	}
	if !hasFiles(bridgeDir, "voice_bridge.py") {
		return nil, nil, errors.New("本安装包缺少新版助手脚本；请重新解压，不会改用旧版。")
	}
	if !hasFiles(runtimeDir, "model/en.phone") && !hasFiles(bridgeDir, "en.phone") {
		return nil, nil, errors.New("缺少英语发音词表。请运行 VoiceRoutes-KWS-Windows 内的 Prepare-Helper.cmd，再选择该文件夹。")
	}
	python := filepath.Join(runtimeDir, ".venv", "Scripts", "python.exe")
	script := filepath.Join(bridgeDir, "voice_bridge.py")
	exe, err := windows.UTF16PtrFromString(python)
	if err != nil {
		return nil, nil, err
	}
	args, err := windows.UTF16PtrFromString(windows.ComposeCommandLine([]string{python, "-I", "-B", "-u", "-X", "utf8", "-c", runBridge, runtimeDir, script}))
	if err != nil {
		return nil, nil, err
	}
	dir, err := windows.UTF16PtrFromString(runtimeDir)
	if err != nil {
		return nil, nil, err
	}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, nil, err
	}
	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	keepJob := false
	defer func() {
		if !keepJob {
			_ = windows.CloseHandle(job)
		}
	}()
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		return nil, nil, err
	}

	// Capture only the owned helper's stdout. The explicit handle list keeps
	// the pipe/token out of all unrelated child processes.
	r, w, err := os.Pipe()
	if err != nil {
		return nil, nil, err
	}
	defer w.Close()
	keepRead := false
	defer func() {
		if !keepRead {
			_ = r.Close()
		}
	}()
	nul, err := os.OpenFile("NUL", os.O_RDWR, 0)
	if err != nil {
		return nil, nil, err
	}
	defer nul.Close()
	wHandle, nulHandle := windows.Handle(w.Fd()), windows.Handle(nul.Fd())
	for _, h := range []windows.Handle{wHandle, nulHandle} {
		if err := windows.SetHandleInformation(h, windows.HANDLE_FLAG_INHERIT, windows.HANDLE_FLAG_INHERIT); err != nil {
			return nil, nil, err
		}
	}
	attributes, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		return nil, nil, err
	}
	defer attributes.Delete()
	handles := []windows.Handle{wHandle, nulHandle}
	if err := attributes.Update(windows.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, unsafe.Pointer(&handles[0]), uintptr(len(handles))*unsafe.Sizeof(handles[0])); err != nil {
		return nil, nil, err
	}
	si := windows.StartupInfoEx{
		StartupInfo: windows.StartupInfo{
			Flags: windows.STARTF_USESTDHANDLES, StdInput: nulHandle, StdOutput: wHandle, StdErr: nulHandle,
		},
		ProcThreadAttributeList: attributes.List(),
	}
	si.Cb = uint32(unsafe.Sizeof(si))
	var p windows.ProcessInformation
	if err := windows.CreateProcess(exe, args, nil, nil, true,
		windows.CREATE_NO_WINDOW|windows.CREATE_SUSPENDED|windows.EXTENDED_STARTUPINFO_PRESENT,
		nil, dir, &si.StartupInfo, &p); err != nil {
		return nil, nil, err
	}
	defer windows.CloseHandle(p.Thread)
	// The venv launcher itself may start a child. Assign it before it can run
	// so pause, exit, and desktop process crashes release the microphone.
	if err := windows.AssignProcessToJobObject(job, p.Process); err != nil {
		_ = windows.TerminateProcess(p.Process, 1)
		_ = windows.CloseHandle(p.Process)
		return nil, nil, err
	}
	if _, err := windows.ResumeThread(p.Thread); err != nil {
		_ = windows.CloseHandle(p.Process)
		return nil, nil, err
	}
	keepRead, keepJob = true, true
	return &helperProcess{process: p.Process, job: job}, r, nil
}

func watchHelper(p *helperProcess, output io.ReadCloser, onToken func(string), done func()) {
	defer done()
	defer output.Close()
	defer windows.CloseHandle(p.process)
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 64*1024)
	published := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !published && strings.HasPrefix(line, "本次连接码：") {
			token := strings.TrimPrefix(line, "本次连接码：")
			if protocol.ValidToken(token) {
				published = true
				onToken(token)
			}
		}
	}
	// EOF (including an invalid/oversize output) means it cannot be trusted
	// to continue. Even if Python's venv launcher itself exited independently,
	// stop the whole job to ensure the microphone is freed.
	p.stop()
	_, _ = windows.WaitForSingleObject(p.process, windows.INFINITE)
}

var messageBeep = windows.NewLazySystemDLL("user32.dll").NewProc("MessageBeep")

func playCue() { _, _, _ = messageBeep.Call(0x40) } // Windows information cue

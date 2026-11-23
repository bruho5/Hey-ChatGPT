package main

import (
	"bufio"
	"debug/pe"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const parentKey = `Software\Google\Chrome\NativeMessagingHosts`
const keyPath = parentKey + `\` + hostName

func regularFile(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("not a regular file: %s", path)
	}
	return nil
}

func checkBinary(path string) error {
	if err := regularFile(path); err != nil {
		return err
	}
	b, err := pe.Open(path)
	if err != nil {
		return err
	}
	defer b.Close()
	if b.Machine != pe.IMAGE_FILE_MACHINE_AMD64 {
		return fmt.Errorf("not a Windows x64 executable: %s", path)
	}
	return nil
}

func checkExtension(path string) (string, error) {
	if err := regularFile(path); err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var manifest struct {
		ManifestVersion int      `json:"manifest_version"`
		Permissions     []string `json:"permissions"`
		Key             string   `json:"key"`
	}
	if json.Unmarshal(data, &manifest) != nil || manifest.ManifestVersion != 3 ||
		!slices.Contains(manifest.Permissions, "nativeMessaging") {
		return "", fmt.Errorf("not the Hey, ChatGPT desktop Chrome companion: %s", path)
	}
	return idForManifestKey(manifest.Key)
}

// Chrome searches the 32-bit view first, then the 64-bit view. On Windows x64
// this HKCU path is shared, but inspecting both avoids overriding a conflict.
func checkKey(view uint32, manifest string) (bool, error) {
	link, err := registry.OpenKey(registry.CURRENT_USER, keyPath, registry.READ|view)
	if errors.Is(err, registry.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer link.Close()
	v, kind, verr := link.GetStringValue("")
	vals, nerr := link.ReadValueNames(0)
	names, suberr := link.ReadSubKeyNames(0)
	if verr != nil || kind != registry.SZ || !strings.EqualFold(v, manifest) ||
		nerr != nil || len(vals) != 1 || vals[0] != "" ||
		suberr != nil || len(names) != 0 {
		return false, fmt.Errorf("existing Chrome native host registration is not owned by this extracted bundle")
	}
	return true, nil
}

func readExisting(path, exe string) (string, error) {
	if err := regularFile(path); errors.Is(err, os.ErrNotExist) {
		return "", nil
	} else if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return validateManifest(data, exe)
}

func writeManifest(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".chrome-link-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	_, err = tmp.Write(data)
	cerr := tmp.Close()
	if err != nil || cerr != nil {
		return errors.Join(err, cerr)
	}
	return os.Rename(tmp.Name(), path)
}

func run(input io.Reader, output io.Writer, args []string) error {
	flags := flag.NewFlagSet("Chrome-Link", flag.ContinueOnError)
	flags.SetOutput(output)
	remove := flags.Bool("remove", false, "unregister only this extracted bundle")
	id := flags.String("id", "", "Chrome extension ID")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() > 0 || (*remove && *id != "") {
		return fmt.Errorf("use -id with a Chrome extension ID, or -remove, not both")
	}

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	folder := filepath.Dir(exe)
	bundle := filepath.Dir(folder)
	host := filepath.Join(bundle, "hey-native-host.exe")
	manifest := filepath.Join(folder, hostName+".json")
	views := []uint32{registry.WOW64_32KEY, registry.WOW64_64KEY}
	oldOrigin, err := readExisting(manifest, host)
	if err != nil {
		return err
	}
	for _, view := range views {
		registered, err := checkKey(view, manifest)
		if err != nil {
			return err
		}
		if registered && oldOrigin == "" {
			return fmt.Errorf("existing Chrome registration points here but its original manifest is missing; no changes made")
		}
	}

	console := bufio.NewReader(input)
	prompt := func(label string) string {
		fmt.Fprint(output, label)
		answer, _ := console.ReadString('\n')
		return strings.TrimSpace(answer)
	}
	if *remove {
		if oldOrigin == "" {
			return fmt.Errorf("no manifest from this bundle was found")
		}
		if prompt("Remove this bundle's authorization for "+oldOrigin+"? Type YES: ") != "YES" {
			fmt.Fprintln(output, "Canceled. No changes made.")
			return nil
		}
		for _, view := range views {
			registered, err := checkKey(view, manifest)
			if err != nil {
				return err
			}
			if registered {
				// The Chrome key itself only. No recursion or policy values.
				parent, err := registry.OpenKey(registry.CURRENT_USER, parentKey, registry.WRITE|view)
				if err != nil {
					return err
				}
				delErr := registry.DeleteKey(parent, hostName)
				parent.Close()
				if delErr != nil && !errors.Is(delErr, registry.ErrNotExist) {
					return delErr
				}
			}
		}
		// Retain the inert manifest to avoid removing a concurrent replacement.
		fmt.Fprintln(output, "Unregistered. Restart Chrome to close any existing connection.")
		return nil
	}
	for _, exe := range []string{host, filepath.Join(bundle, "Hey-ChatGPT.exe")} {
		if err := checkBinary(exe); err != nil {
			return err
		}
	}
	expected, err := checkExtension(filepath.Join(bundle, "VoiceRoutes-Web", "manifest.json"))
	if err != nil {
		return err
	}
	if err := regularFile(filepath.Join(bundle, "VoiceRoutes-Bridge", "voice_bridge.py")); err != nil {
		return err
	}
	if *id == "" {
		*id = prompt("Paste the ID of this unpacked extension from chrome://extensions: ")
	}
	origin, err := originFor(*id)
	if err != nil {
		return err
	}
	if expected != "" && origin != "chrome-extension://"+expected+"/" {
		return fmt.Errorf("that ID belongs to a different extension; the companion ID ends in %s", expected[len(expected)-8:])
	}
	fmt.Fprintln(output, "This authorizes one extension for this Windows user:")
	fmt.Fprintln(output, origin)
	fmt.Fprintln(output, "Host:", host)
	if oldOrigin != "" {
		fmt.Fprintln(output, "Previously allowed origin:", oldOrigin)
	}
	if prompt("Check it matches the Chrome extension card, then type YES to register: ") != "YES" {
		fmt.Fprintln(output, "Canceled. No changes made.")
		return nil
	}

	for _, view := range views {
		if _, err := checkKey(view, manifest); err != nil {
			return err
		}
	}
	if current, err := readExisting(manifest, host); err != nil || current != oldOrigin {
		return fmt.Errorf("the manifest changed during confirmation; rerun setup")
	}
	data, err := renderManifest(host, origin)
	if err != nil {
		return err
	}
	if err := writeManifest(manifest, data); err != nil {
		return err
	}
	key, existed, err := registry.CreateKey(registry.CURRENT_USER, keyPath, registry.SET_VALUE|registry.QUERY_VALUE|registry.WOW64_32KEY)
	if err != nil {
		return err
	}
	defer key.Close()
	if existed {
		value, kind, err := key.GetStringValue("")
		if err != nil || kind != registry.SZ || !strings.EqualFold(value, manifest) {
			return fmt.Errorf("the Chrome registration changed during setup; it was not replaced")
		}
	}
	if err := key.SetStringValue("", manifest); err != nil {
		return err
	}
	fmt.Fprintln(output, "Registered. Reload the extension in chrome://extensions, then open Hey-ChatGPT.exe.")
	return nil
}

func main() {
	if err := run(os.Stdin, os.Stdout, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "Chrome link setup failed:", err)
		os.Exit(1)
	}
}

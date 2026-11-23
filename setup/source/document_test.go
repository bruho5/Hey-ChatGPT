package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOriginValidation(t *testing.T) {
	good := "abcdefghijklmnopabcdefghijklmnop"
	got, err := originFor(" \t" + good + "\r\n")
	if err != nil || got != "chrome-extension://"+good+"/" {
		t.Fatalf("origin %q: %v", got, err)
	}
	for _, bad := range []string{"", strings.Repeat("a", 31), strings.Repeat("A", 32), strings.Repeat("z", 32), good + "/", "https://" + good, strings.Repeat("a", 30) + ";&", "chrome-extension://" + good + "/", strings.Repeat("a", 31) + "а"} {
		if _, err := originFor(bad); err == nil {
			t.Fatalf("accepted invalid ID %q", bad)
		}
	}
}

func TestManifestRoundTripAndOwnership(t *testing.T) {
	path := `C:\Example & Projects\目录\hey-native-host.exe`
	origin, _ := originFor(strings.Repeat("a", 32))
	data, err := renderManifest(path, origin)
	if err != nil {
		t.Fatal(err)
	}
	observed, err := validateManifest(data, strings.ToLower(path))
	if err != nil || observed != origin {
		t.Fatalf("round-trip %q: %v", observed, err)
	}
	for _, tweak := range []func(*nativeManifest){
		func(m *nativeManifest) { m.Name = "com.unrelated.host" },
		func(m *nativeManifest) { m.Path = `C:\another\hey-native-host.exe` },
		func(m *nativeManifest) { m.Description = "unrelated registration" },
		func(m *nativeManifest) { m.Type = "http" },
		func(m *nativeManifest) { m.AllowedOrigins = nil },
		func(m *nativeManifest) { m.AllowedOrigins = append(m.AllowedOrigins, origin) },
		func(m *nativeManifest) { m.AllowedOrigins[0] = "chrome-extension://*/" },
		func(m *nativeManifest) { m.AllowedOrigins[0] = strings.TrimSuffix(origin, "/") },
		func(m *nativeManifest) { m.AllowedOrigins[0] += "#" },
	} {
		var m nativeManifest
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		tweak(&m)
		invalid, _ := json.Marshal(m)
		if _, err := validateManifest(invalid, path); err == nil {
			t.Errorf("treated an invalid/unrelated manifest as owned: %s", invalid)
		}
	}
}

func TestIDFromManifestKey(t *testing.T) {
	id, err := idForManifestKey("YWJj")
	if err != nil || id != "lkhibglpipabmpokebebeanofnkocccd" {
		t.Fatalf("unexpected SHA256-based ID %q %v", id, err)
	}
	if id, err := idForManifestKey(""); err != nil || id != "" {
		t.Fatalf("unexpected result for unpacked keyless extension %q %v", id, err)
	}
	if _, err := idForManifestKey("@@@"); err == nil {
		t.Fatal("malformed public key accepted")
	}
}

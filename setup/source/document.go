package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

const hostName = "com.heychatgpt.bridge"
const description = "Hey, ChatGPT Windows tray bridge"

type nativeManifest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Path           string   `json:"path"`
	Type           string   `json:"type"`
	AllowedOrigins []string `json:"allowed_origins"`
}

var extensionID = regexp.MustCompile(`^[a-p]{32}$`)

func originFor(id string) (string, error) {
	id = strings.TrimSpace(id)
	if !extensionID.MatchString(id) {
		return "", fmt.Errorf("invalid ID: copy the 32 lowercase letters a-p from your Chrome extension card")
	}
	return "chrome-extension://" + id + "/", nil
}

func renderManifest(path, origin string) ([]byte, error) {
	return json.MarshalIndent(nativeManifest{hostName, description, path, "stdio", []string{origin}}, "", "  ")
}

func validateManifest(data []byte, executable string) (string, error) {
	var m nativeManifest
	const prefix = "chrome-extension://"
	if err := json.Unmarshal(data, &m); err != nil ||
		m.Name != hostName || m.Description != description || m.Type != "stdio" ||
		!strings.EqualFold(m.Path, executable) || len(m.AllowedOrigins) != 1 ||
		!strings.HasPrefix(m.AllowedOrigins[0], prefix) || !strings.HasSuffix(m.AllowedOrigins[0], "/") {
		return "", fmt.Errorf("this bundle did not create the existing native host manifest")
	}
	origin, err := originFor(strings.TrimSuffix(strings.TrimPrefix(m.AllowedOrigins[0], prefix), "/"))
	if err != nil || origin != m.AllowedOrigins[0] {
		return "", fmt.Errorf("the existing native host manifest has an invalid extension origin")
	}
	return origin, nil
}

// Chrome derives the ID from the first 128 bits of the manifest public-key SHA256.
func idForManifestKey(key string) (string, error) {
	if key == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(raw) == 0 {
		return "", fmt.Errorf("the bundle has an invalid Chrome public key")
	}
	digest := sha256.Sum256(raw)
	id := make([]byte, 32)
	for i, b := range digest[:16] {
		id[i*2] = 'a' + (b >> 4)
		id[i*2+1] = 'a' + (b & 15)
	}
	return string(id), nil
}

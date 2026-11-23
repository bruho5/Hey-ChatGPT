// Package protocol defines the narrowly-scoped tray/Chrome message schema.
package protocol

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
)

const MaxFrame = 4096

var tokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

func ValidToken(s string) bool { return tokenPattern.MatchString(s) }

type State struct {
	Type    string `json:"type"`
	Enabled bool   `json:"enabled"`
	Token   string `json:"token,omitempty"`
}

func Status(token string) State {
	if !ValidToken(token) {
		return State{Type: "state"}
	}
	return State{Type: "state", Enabled: true, Token: token}
}

func (s State) IsValid() bool {
	return s.Type == "state" && ((!s.Enabled && s.Token == "") || (s.Enabled && ValidToken(s.Token)))
}

type Command struct {
	Type    string `json:"type"`
	Message string `json:"message,omitempty"`
}

func (c Command) IsValid() bool {
	switch c.Type {
	case "cue":
		return c.Message == ""
	case "status":
		return len(c.Message) <= 560
	default:
		return false
	}
}

// Read consumes exactly one length-prefixed JSON object and rejects unknown
// fields. Windows (Chrome's native endianness on that platform) is little endian.
func Read(r io.Reader, v any) error {
	var head [4]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return err
	}
	n := binary.LittleEndian.Uint32(head[:])
	if n == 0 || n > MaxFrame {
		return errors.New("invalid Native Messaging frame size")
	}
	p := make([]byte, n)
	if _, err := io.ReadFull(r, p); err != nil {
		return err
	}
	if p = bytes.TrimSpace(p); len(p) == 0 || p[0] != '{' {
		return errors.New("message is not a JSON object")
	}
	d := json.NewDecoder(bytes.NewReader(p))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("unexpected JSON after message")
	}
	return nil
}

func Write(w io.Writer, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(data) == 0 || len(data) > MaxFrame {
		return fmt.Errorf("message too large")
	}
	frame := make([]byte, 4+len(data))
	binary.LittleEndian.PutUint32(frame, uint32(len(data)))
	copy(frame[4:], data)
	n, err := w.Write(frame)
	if err == nil && n != len(frame) {
		err = io.ErrShortWrite
	}
	return err
}

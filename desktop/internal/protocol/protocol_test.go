package protocol

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestRoundTripAndTokenScope(t *testing.T) {
	valid := strings.Repeat("a", 43)
	want := Status(valid)
	var b bytes.Buffer
	if err := Write(&b, want); err != nil {
		t.Fatal(err)
	}
	if binary.LittleEndian.Uint32(b.Bytes()[:4]) != uint32(b.Len()-4) {
		t.Fatal("frame length is not little endian")
	}
	var got State
	if err := Read(&b, &got); err != nil || got != want || !got.IsValid() {
		t.Fatalf("bad state parse: %v", err)
	}
	if err := Write(&b, Status("not a valid token")); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(b.String(), "token") || !strings.Contains(b.String(), `"enabled":false`) {
		t.Fatal("disabled state leaked token or failed to publish false")
	}
	if (State{Type: "state", Token: valid}).IsValid() || (State{Type: "state", Enabled: true}).IsValid() {
		t.Fatal("inconsistent token visibility")
	}
}

func TestMalformedTransport(t *testing.T) {
	for _, str := range []string{`null`, `["cue"]`, `{"type":"cue"}{}`, `{"type":"cue","token":"ignored"}`} {
		b := new(bytes.Buffer)
		binary.Write(b, binary.LittleEndian, uint32(len(str)))
		b.WriteString(str)
		var cmd Command
		if err := Read(b, &cmd); err == nil {
			t.Fatalf("accepted invalid frame: %q", str)
		}
	}
	for _, size := range []uint32{0, MaxFrame + 1} {
		b := new(bytes.Buffer)
		binary.Write(b, binary.LittleEndian, size)
		if err := Read(b, new(Command)); err == nil {
			t.Fatalf("accepted invalid size %d", size)
		}
	}
	if err := Read(bytes.NewReader([]byte{7, 0, 0, 0, 1}), new(Command)); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("expected short frame, got %v", err)
	}
}

func TestCommandAllowlist(t *testing.T) {
	expected := []struct {
		c  Command
		ok bool
	}{
		{Command{Type: "cue"}, true},
		{Command{Type: "status", Message: "recording"}, true},
		{Command{Type: "status", Message: strings.Repeat("a", 561)}, false},
		{Command{Type: "cue", Message: "unexpected"}, false},
		{Command{Type: "execute-script"}, false},
	}
	for _, v := range expected {
		if v.c.IsValid() != v.ok {
			t.Errorf("unexpected command validation: %q", v.c.Type)
		}
	}
}

// Independent adapter launched by Chrome. Stdout must contain only frames.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"heychatgpt/internal/pipe"
	"heychatgpt/internal/protocol"
)

var extensionOrigin = regexp.MustCompile(`^chrome-extension://[a-p]{32}$`)

func isAllowed(executable, origin string) bool {
	origin = strings.TrimSuffix(origin, "/")
	if !extensionOrigin.MatchString(origin) {
		return false
	}
	f, err := os.Open(filepath.Join(filepath.Dir(executable), "setup", "com.heychatgpt.bridge.json"))
	if err != nil {
		return false
	}
	defer f.Close()
	var manifest struct {
		Name           string   `json:"name"`
		Path           string   `json:"path"`
		Type           string   `json:"type"`
		AllowedOrigins []string `json:"allowed_origins"`
	}
	b, err := io.ReadAll(io.LimitReader(f, 8193))
	if err != nil || len(b) > 8192 || json.Unmarshal(b, &manifest) != nil || manifest.Name != "com.heychatgpt.bridge" ||
		manifest.Type != "stdio" || !strings.EqualFold(filepath.Clean(manifest.Path), filepath.Clean(executable)) ||
		len(manifest.AllowedOrigins) != 1 {
		return false
	}
	return strings.TrimSuffix(manifest.AllowedOrigins[0], "/") == origin
}

func readCommands(ctx context.Context, r io.Reader, out chan<- protocol.Command, closeHost context.CancelFunc) {
	defer closeHost()
	for {
		var msg protocol.Command
		if protocol.Read(r, &msg) != nil || !msg.IsValid() {
			return
		}
		// If disconnected or a peer is stuck, do not stockpile old commands.
		select {
		case <-ctx.Done():
			return
		case out <- msg:
		default:
		}
	}
}

func pipeSession(ctx context.Context, c net.Conn, commands <-chan protocol.Command, emit func(protocol.State) error) error {
	defer c.Close()
	type reply struct {
		state protocol.State
		err   error
	}
	r := make(chan reply)
	closed := make(chan struct{})
	defer close(closed)
	go func() {
		for {
			var state protocol.State
			err := protocol.Read(c, &state)
			if err == nil && !state.IsValid() {
				err = errors.New("invalid tray state")
			}
			select {
			case <-closed:
				return
			case r <- reply{state, err}:
			}
			if err != nil {
				return
			}
		}
	}()
	enabled := false
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case reply := <-r:
			if reply.err != nil {
				return reply.err
			}
			enabled = reply.state.Enabled
			if err := emit(reply.state); err != nil {
				return err
			}
		case command := <-commands:
			if enabled {
				if err := c.SetWriteDeadline(time.Now().Add(time.Second)); err != nil {
					return err
				}
				if err := protocol.Write(c, command); err != nil {
					return err
				}
			}
		}
	}
}

func run(ctx context.Context, input io.Reader, output io.Writer) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	commands := make(chan protocol.Command)
	go readCommands(ctx, input, commands, cancel)
	last := protocol.State{}
	emit := func(state protocol.State) error {
		if state == last {
			return nil
		}
		if err := protocol.Write(output, state); err != nil {
			cancel()
			return err
		}
		last = state
		return nil
	}
	if emit(protocol.Status("")) != nil {
		return
	}

	for ctx.Err() == nil {
		deadline, stop := context.WithTimeout(ctx, time.Second)
		conn, err := pipe.Dial(deadline)
		stop()
		if err == nil {
			_ = pipeSession(ctx, conn, commands, emit)
			if emit(protocol.Status("")) != nil {
				return
			}
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func main() {
	executable, err := os.Executable()
	if err != nil || len(os.Args) < 2 || !isAllowed(executable, os.Args[1]) {
		fmt.Fprintln(os.Stderr, "Hey, ChatGPT native host: Chrome extension not registered for this package.")
		return
	}
	run(context.Background(), os.Stdin, os.Stdout)
}

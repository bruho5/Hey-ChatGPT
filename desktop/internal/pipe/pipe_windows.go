package pipe

import (
	"context"
	"errors"
	"net"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

func identity() (name, sddl string, err error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return "", "", err
	}
	sid := user.User.Sid.String()
	// No Everyone, Anonymous, Network, or Administrators ACE. The local
	// current user's SID is the explicit owner and sole allowed principal.
	return `\\.\pipe\com.heychatgpt.bridge.v1.` + sid, "O:" + sid + "D:P(A;;GA;;;" + sid + ")", nil
}

func Listen() (net.Listener, error) {
	name, acl, err := identity()
	if err != nil {
		return nil, err
	}
	// go-winio creates a unique first instance and rejects remote clients.
	return winio.ListenPipe(name, &winio.PipeConfig{SecurityDescriptor: acl, InputBufferSize: 4096, OutputBufferSize: 4096})
}

func Dial(ctx context.Context) (net.Conn, error) {
	name, _, err := identity()
	if err != nil {
		return nil, err
	}
	c, err := winio.DialPipeContext(ctx, name)
	if err != nil {
		return nil, err
	}
	if err := CheckPeer(c, false); err != nil {
		c.Close()
		return nil, err
	}
	return c, nil
}

// CheckPeer defends against another Windows user's pipe squatting, even if
// that user creates a guessed pipe name and grants us permission to open it.
func CheckPeer(c net.Conn, server bool) error {
	f, ok := c.(interface{ Fd() uintptr })
	if !ok {
		return errors.New("missing named-pipe handle")
	}
	var pid uint32
	var err error
	if server {
		err = windows.GetNamedPipeClientProcessId(windows.Handle(f.Fd()), &pid)
	} else {
		err = windows.GetNamedPipeServerProcessId(windows.Handle(f.Fd()), &pid)
	}
	if err != nil {
		return err
	}
	p, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(p)
	var token windows.Token
	if err := windows.OpenProcessToken(p, windows.TOKEN_QUERY, &token); err != nil {
		return err
	}
	defer token.Close()
	them, err := token.GetTokenUser()
	if err != nil {
		return err
	}
	us, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return err
	}
	if !us.User.Sid.Equals(them.User.Sid) {
		return errors.New("named-pipe peer belongs to another Windows user")
	}
	return nil
}

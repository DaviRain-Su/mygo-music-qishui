package plugin

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Importing a built source folder must retain executable native components.
func TestQishuiPluginFolderInstall(t *testing.T) {
	source := os.Getenv("QISHUI_SOURCE_DIR")
	if source == "" {
		t.Fatal("source folder was not provided")
	}
	destination := t.TempDir()
	pending, err := Open(source, destination)
	if err != nil {
		t.Fatal(err)
	}
	defer pending.Discard()
	if err := pending.Install(destination); err != nil {
		t.Fatal(err)
	}
	installed := filepath.Join(destination, "qishui")
	for _, name := range []string{"bin/qishui-helper-darwin-arm64", "runtime/native/qishui-sign", "runtime/native/bdms.node", "runtime/native/libMetaSecML.dylib"} {
		info, err := os.Stat(filepath.Join(installed, name))
		if err != nil || info.Mode()&0111 == 0 {
			t.Fatal("folder import lost an executable component:", name)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, filepath.Join(installed, "bin/qishui-helper-darwin-arm64"))
	command.Dir = installed
	command.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + os.Getenv("HOME")}
	command.Stderr = io.Discard
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal("folder-imported helper did not start")
	}
	defer func() {
		_ = stdin.Close()
		if command.ProcessState == nil {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	}()
	frame := `{"op":"music","method":"sign","session":{"version":1,"deviceID":"1234567890123456","installID":"123456789012345"},"params":{"url":"https://api.qishui.com/luna/pc/track_v2?aid=386088&app_name=luna_pc&device_id=1234567890123456&fp=1234567890123456","did":"1234567890123456","headers":{"accept":"application/json"}}}`
	if _, err := io.WriteString(stdin, frame+"\n"); err != nil {
		t.Fatal("native input unavailable")
	}
	var response struct {
		OK     bool
		Result map[string]string
	}
	if json.NewDecoder(stdout).Decode(&response) != nil || !response.OK || len(response.Result) != 2 || response.Result["x-helios"] == "" || response.Result["x-medusa"] == "" {
		t.Fatal("folder-imported components did not sign")
	}
	_ = stdin.Close()
	if command.Wait() != nil {
		t.Fatal("folder-imported helper did not exit")
	}
}

// A granted plugin with absent components must explain the actual startup failure.
func TestQishuiPluginMissingComponents(t *testing.T) {
	qishuiAuthFixture(t)
	folder := t.TempDir()
	for _, name := range []string{"plugin.json", "index.js"} {
		b, err := os.ReadFile(filepath.Join(os.Getenv("QISHUI_SOURCE_DIR"), name))
		if err != nil {
			t.Fatal(err)
		}
		if os.WriteFile(filepath.Join(folder, name), b, 0600) != nil {
			t.Fatal("cannot prepare missing-runtime case")
		}
	}
	p, err := Load(folder, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if p.Grant(true) != nil {
		t.Fatal("cannot grant fixture permission")
	}
	if account, err := p.SignIn(); err != nil || account == nil {
		t.Fatal("fixture login failed")
	}
	_, err = p.Home()
	if err == nil || !strings.Contains(err.Error(), "缺少原生组件") || strings.Contains(err.Error(), "请允许") {
		t.Fatal("missing components were confused with process consent")
	}
}

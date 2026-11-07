package plugin

import (
	"os"
	"path/filepath"
	"testing"
)

// The actual source folder and release zip must pass MyGo Open + Install, not just Load.
func TestQishuiInstallArtifacts(t *testing.T) {
	for name, artifact := range map[string]string{
		"source-folder": os.Getenv("QISHUI_PLUGIN_DIR"),
		"release-zip":   os.Getenv("QISHUI_PLUGIN_ZIP"),
	} {
		t.Run(name, func(t *testing.T) {
			if artifact == "" {
				t.Skip("set QISHUI_PLUGIN_DIR / QISHUI_PLUGIN_ZIP to run installer acceptance")
			}
			destination := t.TempDir()
			pending, err := Open(artifact, destination)
			if err != nil {
				t.Fatalf("MyGo refused the plugin: %v", err)
			}
			defer pending.Discard()
			if err := pending.Install(destination); err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"plugin.json", "index.js", "helper/launch.cjs", "helper/install.cjs", "helper/dependencies.cjs", "helper/package-lock.json"} {
				if _, err := os.Stat(filepath.Join(destination, "qishui", name)); err != nil {
					t.Fatal(err)
				}
			}
			if err := filepath.WalkDir(filepath.Join(destination, "qishui"), func(path string, entry os.DirEntry, err error) error {
				if err != nil {
					return err
				}
				if entry.Name() == "node_modules" || entry.Type()&os.ModeSymlink != 0 {
					t.Fatalf("dependency/link leaked into plugin package: %s", path)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

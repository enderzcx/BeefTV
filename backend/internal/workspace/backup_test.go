package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBackupRestoreRoundTrip(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "workspace")
	if err := os.MkdirAll(filepath.Join(source, "resources", "local"), 0o700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"open_ai_canvas.db":             "sqlite-data",
		LocalProviderConfigFile:         `{"channels":[]}`,
		"resources/local/generated.png": "image-bytes",
	}
	for name, body := range files {
		path := filepath.Join(source, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	archive := filepath.Join(root, "backup.tar.gz")
	if err := Backup(source, archive); err != nil {
		t.Fatal(err)
	}
	restored := filepath.Join(root, "restored")
	if err := Restore(archive, restored); err != nil {
		t.Fatal(err)
	}
	for name, want := range files {
		body, err := os.ReadFile(filepath.Join(restored, filepath.FromSlash(name)))
		if err != nil || string(body) != want {
			t.Fatalf("restored %s = %q, %v", name, body, err)
		}
	}
	if err := Restore(archive, restored); err == nil {
		t.Fatal("restore overwrote an existing workspace")
	}
}

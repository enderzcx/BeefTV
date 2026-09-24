//go:build windows

package asset

import (
	"os"
	"syscall"
	"testing"

	"golang.org/x/sys/windows"
)

func TestSyncDirectoryAcceptsWindowsDirectoryHandle(t *testing.T) {
	dir := t.TempDir()
	if err := syncDirectory(dir); err != nil {
		t.Fatalf("Windows directory Sync must not fail with Access is denied: %v", err)
	}
}

func TestIgnorableWindowsDirectorySyncErrorOnlyAccessDenied(t *testing.T) {
	denied := &os.PathError{Op: "sync", Path: `C:\Users\Administrator\AppData\Local\Temp\resources`, Err: syscall.ERROR_ACCESS_DENIED}
	if !isIgnorableWindowsDirectorySyncError(denied) {
		t.Fatal("ERROR_ACCESS_DENIED from directory FlushFileBuffers must be ignorable")
	}
	if isIgnorableWindowsDirectorySyncError(&os.PathError{Op: "sync", Path: `C:\Users\Administrator\AppData\Local\Temp\resources`, Err: windows.ERROR_INVALID_HANDLE}) {
		t.Fatal("ERROR_INVALID_HANDLE must not be ignored")
	}
	if isIgnorableWindowsDirectorySyncError(os.ErrPermission) {
		t.Fatal("generic permission errors must not be ignored")
	}
	if isIgnorableWindowsDirectorySyncError(nil) {
		t.Fatal("nil error is not ignorable")
	}
}

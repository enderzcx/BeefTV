//go:build windows

package asset

import (
	"errors"
	"syscall"
)

func syncDirectory(path string) error {
	err := syncDirectoryHandle(path)
	if err == nil {
		return nil
	}
	if isIgnorableWindowsDirectorySyncError(err) {
		return nil
	}
	return err
}

// FlushFileBuffers on a Windows directory handle returns ERROR_ACCESS_DENIED.
// That is the documented NTFS/Win32 limitation, not a failed file persist.
// File Sync and the atomic rename still happen before this call.
func isIgnorableWindowsDirectorySyncError(err error) bool {
	return errors.Is(err, syscall.ERROR_ACCESS_DENIED)
}

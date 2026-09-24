//go:build !windows

package asset

func syncDirectory(path string) error {
	return syncDirectoryHandle(path)
}

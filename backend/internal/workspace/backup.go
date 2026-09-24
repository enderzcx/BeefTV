package workspace

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func Backup(sourceDir, archivePath string) error {
	if strings.TrimSpace(sourceDir) == "" || strings.TrimSpace(archivePath) == "" {
		return errors.New("备份来源和目标不能为空")
	}
	if err := os.MkdirAll(filepath.Dir(archivePath), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(archivePath), ".workspace-backup-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	gzipWriter := gzip.NewWriter(tmp)
	tarWriter := tar.NewWriter(gzipWriter)
	walkErr := filepath.Walk(sourceDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("备份不允许符号链接: %s", path)
		}
		relative, err := filepath.Rel(sourceDir, path)
		if err != nil || relative == "." {
			return err
		}
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = filepath.ToSlash(relative)
		if err := tarWriter.WriteHeader(header); err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(tarWriter, file)
		closeErr := file.Close()
		return errors.Join(copyErr, closeErr)
	})
	closeErr := errors.Join(tarWriter.Close(), gzipWriter.Close(), tmp.Sync(), tmp.Close())
	if err := errors.Join(walkErr, closeErr); err != nil {
		return err
	}
	return os.Rename(tmpPath, archivePath)
}

func Restore(archivePath, targetDir string) error {
	if _, err := os.Stat(targetDir); err == nil {
		return errors.New("恢复目标已存在，拒绝覆盖")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	parent := filepath.Dir(targetDir)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return err
	}
	tmpDir, err := os.MkdirTemp(parent, ".workspace-restore-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)
	archive, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	gzipReader, err := gzip.NewReader(archive)
	if err != nil {
		_ = archive.Close()
		return err
	}
	reader := tar.NewReader(gzipReader)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			_ = gzipReader.Close()
			_ = archive.Close()
			return err
		}
		clean := filepath.Clean(filepath.FromSlash(header.Name))
		if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return errors.New("备份包含越界路径")
		}
		path := filepath.Join(tmpDir, clean)
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(path, 0o700); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				return err
			}
			file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(file, reader)
			closeErr := file.Close()
			if err := errors.Join(copyErr, closeErr); err != nil {
				return err
			}
		default:
			return errors.New("备份包含不支持的文件类型")
		}
	}
	if err := errors.Join(gzipReader.Close(), archive.Close()); err != nil {
		return err
	}
	return os.Rename(tmpDir, targetDir)
}

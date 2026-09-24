package bootstrap

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

func (r *Runtime) CopyOwnedResourceTo(resourceID, destPath string) error {
	if r == nil || r.service == nil {
		return errors.New("本地后端尚未就绪")
	}
	id, err := sanitizeOwnedResourceID(resourceID)
	if err != nil {
		return err
	}
	dest, err := sanitizeSaveDestination(destPath)
	if err != nil {
		return err
	}
	owner, err := r.service.LocalWorkspaceOwner()
	if err != nil {
		return err
	}
	_, body, err := r.service.OpenResource(owner.ID, id)
	if err != nil {
		return err
	}
	defer body.Close()
	file, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("无法写入所选位置")
	}
	copyErr := copyOwnedResourceBody(file, body)
	if closeErr := file.Close(); copyErr == nil {
		copyErr = closeErr
	}
	if copyErr != nil {
		_ = os.Remove(dest)
		return copyErr
	}
	return nil
}

func copyOwnedResourceBody(file *os.File, body io.Reader) error {
	if _, err := io.Copy(file, body); err != nil {
		return fmt.Errorf("无法写出文件")
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("无法写出文件")
	}
	return nil
}

func sanitizeOwnedResourceID(resourceID string) (string, error) {
	id := strings.TrimSpace(resourceID)
	if id == "" || len(id) > 128 {
		return "", errors.New("没有可导出的本机文件")
	}
	if strings.ContainsAny(id, "/\\:") || strings.Contains(id, "..") {
		return "", errors.New("没有可导出的本机文件")
	}
	for _, r := range id {
		if r < 33 || r > 126 || unicode.IsSpace(r) {
			return "", errors.New("没有可导出的本机文件")
		}
	}
	return id, nil
}

func SanitizeSaveFileName(name string) string {
	return sanitizeSaveFileName(name)
}

func sanitizeSaveFileName(name string) string {
	base := filepath.Base(strings.TrimSpace(name))
	base = strings.ReplaceAll(base, "\x00", "")
	if base == "" || base == "." || base == ".." {
		return "未命名媒体"
	}
	var builder strings.Builder
	for _, r := range base {
		if r < 32 || strings.ContainsRune(`\/:*?"<>|`, r) {
			builder.WriteByte('_')
			continue
		}
		builder.WriteRune(r)
	}
	cleaned := strings.Trim(builder.String(), " .")
	if cleaned == "" || cleaned == "." || cleaned == ".." {
		return "未命名媒体"
	}
	if len(cleaned) > 180 {
		cleaned = strings.TrimRight(cleaned[:180], " .")
	}
	if cleaned == "" {
		return "未命名媒体"
	}
	return cleaned
}

func sanitizeSaveDestination(destPath string) (string, error) {
	dest := strings.TrimSpace(destPath)
	if dest == "" {
		return "", errors.New("没有选择保存位置")
	}
	if dest != filepath.Clean(dest) {
		dest = filepath.Clean(dest)
	}
	info, err := os.Stat(dest)
	if err == nil && info.IsDir() {
		return "", errors.New("保存位置不能是文件夹")
	}
	return dest, nil
}

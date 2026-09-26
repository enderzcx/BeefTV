package desktopupdate

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var relaunchInstall = relaunchTarget

func SwapInstall(req HelperRequest) error {
	switch {
	case strings.HasPrefix(req.Platform, "darwin"):
		return swapDarwin(req)
	case strings.HasPrefix(req.Platform, "windows"):
		return swapWindows(req)
	default:
		return ErrUnsupported
	}
}

func backupRoot(req HelperRequest) string {
	return req.BackupPath
}

func swapDarwin(req HelperRequest) error {
	stagedApp := filepath.Join(req.StagedPath, appBundleName)
	if err := os.MkdirAll(filepath.Dir(req.BackupPath), 0o755); err != nil {
		return err
	}
	if err := retryIO(func() error { return renamePath(req.TargetPath, req.BackupPath) }); err != nil {
		return err
	}
	if err := retryIO(func() error { return renamePath(stagedApp, req.TargetPath) }); err != nil {
		_ = retryIO(func() error { return renamePath(req.BackupPath, req.TargetPath) })
		return err
	}
	return nil
}

func swapWindows(req HelperRequest) error {
	targetDir := filepath.Dir(req.TargetPath)
	stagedExe := filepath.Join(req.StagedPath, windowsExeName)
	stagedPlugins := filepath.Join(req.StagedPath, pluginDirName)
	if err := os.MkdirAll(req.BackupPath, 0o755); err != nil {
		return err
	}
	backupExe := filepath.Join(req.BackupPath, windowsExeName)
	if err := retryIO(func() error { return renamePath(req.TargetPath, backupExe) }); err != nil {
		return err
	}
	targetPlugins := filepath.Join(targetDir, pluginDirName)
	backedUpPlugins := false
	if pathExists(targetPlugins) {
		backupPlugins := filepath.Join(req.BackupPath, pluginDirName)
		if err := retryIO(func() error { return renamePath(targetPlugins, backupPlugins) }); err != nil {
			_ = retryIO(func() error { return renamePath(backupExe, req.TargetPath) })
			return err
		}
		backedUpPlugins = true
	}
	if err := retryIO(func() error { return renamePath(stagedExe, req.TargetPath) }); err != nil {
		restoreWindows(req, backedUpPlugins)
		return err
	}
	if pathExists(stagedPlugins) {
		if err := retryIO(func() error { return renamePath(stagedPlugins, targetPlugins) }); err != nil {
			restoreWindows(req, backedUpPlugins)
			return err
		}
	}
	return nil
}

func restoreWindows(req HelperRequest, pluginsBackedUp bool) {
	targetDir := filepath.Dir(req.TargetPath)
	_ = os.Remove(req.TargetPath)
	_ = os.RemoveAll(filepath.Join(targetDir, pluginDirName))
	_ = retryIO(func() error { return renamePath(filepath.Join(req.BackupPath, windowsExeName), req.TargetPath) })
	if pluginsBackedUp {
		_ = retryIO(func() error {
			return renamePath(filepath.Join(req.BackupPath, pluginDirName), filepath.Join(targetDir, pluginDirName))
		})
	}
}

func RestoreBackup(req HelperRequest) error {
	switch {
	case strings.HasPrefix(req.Platform, "darwin"):
		if !pathExists(req.BackupPath) {
			if pathExists(req.TargetPath) {
				return nil
			}
			return fmt.Errorf("没有可还原的备份")
		}
		if pathExists(req.TargetPath) {
			failed := req.TargetPath + ".beeftv-failed"
			_ = os.RemoveAll(failed)
			_ = renamePath(req.TargetPath, failed)
		}
		return retryIO(func() error { return renamePath(req.BackupPath, req.TargetPath) })
	case strings.HasPrefix(req.Platform, "windows"):
		backupExe := filepath.Join(req.BackupPath, windowsExeName)
		if !pathExists(backupExe) {
			if pathExists(req.TargetPath) {
				return nil
			}
			return fmt.Errorf("没有可还原的备份")
		}
		restoreWindows(req, pathExists(filepath.Join(req.BackupPath, pluginDirName)))
		if !pathExists(req.TargetPath) {
			return fmt.Errorf("还原安装失败")
		}
		return nil
	default:
		return ErrUnsupported
	}
}

func renamePath(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	} else if !isCrossDevice(err) {
		return err
	}
	if err := copyTree(src, dst); err != nil {
		_ = os.RemoveAll(dst)
		return err
	}
	return os.RemoveAll(src)
}

func copyTree(src, dst string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("更新不能复制符号链接")
	}
	if info.IsDir() {
		if err := os.MkdirAll(dst, info.Mode().Perm()); err != nil {
			return err
		}
		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := copyTree(filepath.Join(src, entry.Name()), filepath.Join(dst, entry.Name())); err != nil {
				return err
			}
		}
		return nil
	}
	return copyFile(src, dst)
}

func retryIO(op func() error) error {
	attempts := 8
	if runtime.GOOS == "windows" {
		attempts = 50
	}
	var err error
	for i := 0; i < attempts; i++ {
		err = op()
		if err == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return err
}

func relaunchTarget(req HelperRequest) error {
	switch {
	case strings.HasPrefix(req.Platform, "darwin"):
		cmd := exec.Command("/usr/bin/open", req.TargetPath)
		if err := cmd.Start(); err == nil {
			return nil
		}
		inner := filepath.Join(req.TargetPath, "Contents", "MacOS", "BeefTV")
		return exec.Command(inner).Start()
	case strings.HasPrefix(req.Platform, "windows"):
		cmd := exec.Command(req.TargetPath)
		cmd.Dir = filepath.Dir(req.TargetPath)
		return cmd.Start()
	default:
		return ErrUnsupported
	}
}

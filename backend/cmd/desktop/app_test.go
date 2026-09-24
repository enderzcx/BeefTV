package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"testing"
)

// This catches desktop-shell regressions where Wails opens before the local
// backend has a usable loopback URL and ephemeral launch token.
func TestDesktopAppStartsRuntimeOnLoopback(t *testing.T) {
	app := newDesktopApp(t.TempDir())
	if err := app.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	config := app.RuntimeConfig()
	if !regexp.MustCompile(`^http://127\.0\.0\.1:\d+/api$`).MatchString(config.BaseURL) {
		t.Fatalf("baseURL = %q, want loopback API", config.BaseURL)
	}
	if config.LaunchToken == "" {
		t.Fatal("launch token must be available before the frontend loads")
	}
	if err := app.stop(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopRuntimeConfigEndpointIsAvailableInsideAssetServer(t *testing.T) {
	app := newDesktopApp(t.TempDir())
	if err := app.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer app.stop(context.Background())
	response := httptest.NewRecorder()
	desktopAssetHandler{app: app}.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/__desktop/runtime-config", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var config DesktopRuntimeConfig
	if err := json.Unmarshal(response.Body.Bytes(), &config); err != nil {
		t.Fatal(err)
	}
	if config.BaseURL == "" || config.LaunchToken == "" {
		t.Fatalf("runtime config endpoint returned %#v", config)
	}
}

func TestDesktopAssetServerFallsBackToInProcessAPI(t *testing.T) {
	app := newDesktopApp(t.TempDir())
	if err := app.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer app.stop(context.Background())

	response := httptest.NewRecorder()
	desktopAssetHandler{app: app}.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var envelope struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Code != 0 {
		t.Fatalf("code = %d, want 0", envelope.Code)
	}
}

func TestDesktopAssetServerRoutesLegacyResourcePath(t *testing.T) {
	app := newDesktopApp(t.TempDir())
	if err := app.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer app.stop(context.Background())

	response := httptest.NewRecorder()
	desktopAssetHandler{app: app}.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/resources/missing-resource/file", nil))
	if response.Code == http.StatusNotFound && response.Body.String() == "404 page not found\n" {
		t.Fatal("legacy resource path was handled by the Wails asset server instead of the local API")
	}
}

func TestDesktopAssetServerStartsRuntimeWhenStartupHookHasNotRun(t *testing.T) {
	app := newDesktopApp(t.TempDir())
	defer app.stop(context.Background())

	response := httptest.NewRecorder()
	desktopAssetHandler{app: app}.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	if config := app.RuntimeConfig(); config.BaseURL == "" || config.LaunchToken == "" {
		t.Fatalf("asset request did not lazily start runtime: %#v", config)
	}
}

func TestDefaultDataDirHonorsExplicitDesktopOverride(t *testing.T) {
	want := filepath.Join(t.TempDir(), "workspace")
	t.Setenv("CANVAS_DESKTOP_DATA_DIR", want)
	got, err := defaultDataDir()
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("defaultDataDir() = %q, want %q", got, want)
	}
}

func TestDesktopStartupHookStartsRuntimeBeforeFrontendBootstrap(t *testing.T) {
	app := newDesktopApp(t.TempDir())
	app.startup(context.Background())
	config := app.RuntimeConfig()
	if config.BaseURL == "" || config.LaunchToken == "" {
		t.Fatalf("startup hook did not prepare runtime config: %#v", config)
	}
	app.shutdown(context.Background())
}

func TestPrepareDesktopAppStartsRuntimeBeforeWailsMainLoop(t *testing.T) {
	app := newDesktopApp(t.TempDir())
	if err := prepareDesktopApp(app); err != nil {
		t.Fatal(err)
	}
	defer app.stop(context.Background())
	config := app.RuntimeConfig()
	if config.BaseURL == "" || config.LaunchToken == "" {
		t.Fatalf("desktop app was not ready before Wails main loop: %#v", config)
	}
}

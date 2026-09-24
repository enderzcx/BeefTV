package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/workspace"

	"github.com/gin-gonic/gin"
)

// RegisterWorkspaceRoutes exposes the desktop-first bootstrap contract. The
// workspace scope is injected by the runtime before the router is mounted, so
// this endpoint never reads a cookie or creates an AuthSession.
func RegisterWorkspaceRoutes(r *gin.RouterGroup, svc *app.Service) {
	r.GET("/workspace/bootstrap", func(c *gin.Context) {
		scope, err := CurrentWorkspace(c)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		user, err := svc.WorkspaceOwner(scope.ID)
		if err != nil {
			failService(c, err)
			return
		}
		publicUser := app.AuthUser{User: *user}
		// Desktop model configuration is persisted separately under the workspace
		// data directory. The bootstrap contract contains no account metadata.
		logicalModels := []app.PublicLogicalModel{}
		limits, err := svc.PublicRuntimeLimits()
		if err != nil {
			failService(c, err)
			return
		}
		features, err := svc.FeatureAvailability()
		if err != nil {
			failService(c, err)
			return
		}
		contract := LocalDesktopContract()
		ok(c, gin.H{
			"contractVersion": contract.Version,
			"profile":         contract.Profile,
			"capabilities":    contract.Capabilities,
			"workspace": gin.H{
				"id":      scope.ID,
				"name":    "本地工作区",
				"owner":   "local",
				"storage": "sqlite",
			},
			"user":          publicUser,
			"storageMode":   "local",
			"logicalModels": logicalModels,
			"runtimeLimits": limits,
			"features":      features,
		})
	})
	r.GET("/workspace/model-config", func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, svc); err != nil {
			fail(c, http.StatusUnauthorized, err)
			return
		}
		providerConfig := requestProviderConfig(c, svc)
		if versioned, supportsVersioning := providerConfig.(VersionedProviderConfig); supportsVersioning {
			effective, health, err := versioned.LoadEffectiveModelConfig()
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"config": effective.Config, "revision": effective.Revision, "health": health, "source": "builtin+local"})
			return
		}
		body, err := providerConfig.ReadLocalModelConfig()
		if err != nil {
			failService(c, err)
			return
		}
		if len(body) == 0 {
			ok(c, gin.H{"config": nil})
			return
		}
		var config map[string]any
		if err := json.Unmarshal(body, &config); err != nil {
			fail(c, http.StatusInternalServerError, errors.New("本地模型配置损坏"))
			return
		}
		ok(c, gin.H{"config": config})
	})
	r.PUT("/workspace/model-config", func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, svc); err != nil {
			fail(c, http.StatusUnauthorized, err)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20))
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("本地模型配置读取失败"))
			return
		}
		var envelope struct {
			Config           json.RawMessage `json:"config"`
			ExpectedRevision *int64          `json:"expectedRevision"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil || len(envelope.Config) == 0 || string(envelope.Config) == "null" {
			fail(c, http.StatusBadRequest, errors.New("本地模型配置格式错误"))
			return
		}
		providerConfig := requestProviderConfig(c, svc)
		if versioned, supportsVersioning := providerConfig.(VersionedProviderConfig); supportsVersioning && envelope.ExpectedRevision != nil {
			revision, err := versioned.SaveLocalModelConfigRevision(envelope.Config, *envelope.ExpectedRevision)
			if errors.Is(err, workspace.ErrProviderConfigRevisionConflict) {
				fail(c, http.StatusConflict, err)
				return
			}
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"saved": true, "revision": revision})
			return
		}
		if err := providerConfig.SaveLocalModelConfig(envelope.Config); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"saved": true})
	})
}

func workspaceForLocalRequest(c *gin.Context, svc *app.Service) (workspace.Context, error) {
	if scope, err := CurrentWorkspace(c); err == nil {
		return scope, nil
	}
	if svc.IsLocalMode() {
		return workspace.Context{ID: "local"}, nil
	}
	return workspace.Context{}, errors.New("本地工作区未初始化")
}

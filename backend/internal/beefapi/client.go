package beefapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type deviceCodeRequest struct {
	ClientID      string `json:"client_id"`
	Scope         string `json:"scope"`
	ClientVersion string `json:"client_version"`
	Hostname      string `json:"hostname"`
}

type deviceCodeResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

type tokenRequest struct {
	ClientID   string `json:"client_id"`
	DeviceCode string `json:"device_code"`
}

type tokenSuccess struct {
	APIKey  string  `json:"api_key"`
	BaseURL string  `json:"base_url"`
	Market  string  `json:"market"`
	Group   string  `json:"group"`
	KeyName string  `json:"key_name"`
	TokenID string  `json:"token_id"`
	Account Account `json:"account"`
}

type completeRequest struct {
	ClientID   string `json:"client_id"`
	DeviceCode string `json:"device_code"`
}

type oauthError struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
	ErrorCode        string `json:"error_code"`
}

type connectionView struct {
	Market  string  `json:"market"`
	Account Account `json:"account"`
	TokenID string  `json:"token_id"`
	KeyName string  `json:"key_name"`
}

type modelsPayload struct {
	Data []struct {
		ID                     string   `json:"id"`
		Name                   string   `json:"name"`
		DisplayName            string   `json:"display_name"`
		ModelType              string   `json:"model_type"`
		SupportedEndpointTypes []string `json:"supported_endpoint_types"`
	} `json:"data"`
}

func (s *Service) postJSON(path string, payload any, header http.Header) (*http.Response, []byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	request, err := http.NewRequest(http.MethodPost, s.origin+path, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	for key, values := range header {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	response, err := s.httpClient.Do(request)
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return response, nil, err
	}
	return response, raw, nil
}

func (s *Service) requestDeviceCode() (deviceCodeResponse, error) {
	response, raw, err := s.postJSON("/api/oauth/device/code", deviceCodeRequest{
		ClientID:      ClientID,
		Scope:         ClientScope,
		ClientVersion: s.clientVersion,
		Hostname:      s.hostname,
	}, nil)
	if err != nil {
		return deviceCodeResponse{}, fmt.Errorf("无法开始企业授权")
	}
	if response.StatusCode >= 300 {
		return deviceCodeResponse{}, fmt.Errorf("无法开始企业授权")
	}
	var result deviceCodeResponse
	if err := json.Unmarshal(raw, &result); err != nil || strings.TrimSpace(result.DeviceCode) == "" || strings.TrimSpace(result.UserCode) == "" {
		return deviceCodeResponse{}, fmt.Errorf("企业授权响应无效")
	}
	if result.ExpiresIn <= 0 {
		result.ExpiresIn = 900
	}
	if result.Interval <= 0 {
		result.Interval = 5
	}
	if result.VerificationURI == "" {
		result.VerificationURI = s.origin + "/desktop-auth"
	}
	if _, err := ValidateVerificationURL(s.origin, result.VerificationURI); err != nil {
		return deviceCodeResponse{}, err
	}
	if result.VerificationURIComplete != "" {
		if _, err := ValidateVerificationURL(s.origin, result.VerificationURIComplete); err != nil {
			return deviceCodeResponse{}, err
		}
	}
	return result, nil
}

func (s *Service) pollToken(deviceCode string) (tokenSuccess, string, error) {
	response, raw, err := s.postJSON("/api/oauth/device/token", tokenRequest{ClientID: ClientID, DeviceCode: deviceCode}, nil)
	if err != nil {
		return tokenSuccess{}, "", fmt.Errorf("查询授权状态失败")
	}
	if response.StatusCode == http.StatusOK {
		var result tokenSuccess
		if err := json.Unmarshal(raw, &result); err != nil {
			return tokenSuccess{}, "", fmt.Errorf("企业授权响应无效")
		}
		return result, "", nil
	}
	code := parseOAuthError(raw)
	if code == "" {
		code = "invalid_request"
	}
	return tokenSuccess{}, code, nil
}

func (s *Service) acknowledge(deviceCode string) error {
	response, raw, err := s.postJSON("/api/oauth/device/complete", completeRequest{ClientID: ClientID, DeviceCode: deviceCode}, nil)
	if err != nil {
		return fmt.Errorf("确认企业授权失败")
	}
	if response.StatusCode >= 300 {
		return fmt.Errorf("确认企业授权失败")
	}
	var result struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(raw, &result); err != nil || !result.Success {
		return fmt.Errorf("确认企业授权失败")
	}
	return nil
}

func (s *Service) cancelRemote(deviceCode string) error {
	if strings.TrimSpace(deviceCode) == "" {
		return nil
	}
	_, _, err := s.postJSON("/api/oauth/device/cancel", completeRequest{ClientID: ClientID, DeviceCode: deviceCode}, nil)
	return err
}

func (s *Service) remoteConnection(apiKey string) (connectionView, int, error) {
	request, err := http.NewRequest(http.MethodGet, TokenBaseURL(s.origin)+"/beeftv/connection", nil)
	if err != nil {
		return connectionView{}, 0, err
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Accept", "application/json")
	response, err := s.httpClient.Do(request)
	if err != nil {
		return connectionView{}, 0, err
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode >= 300 {
		return connectionView{}, response.StatusCode, nil
	}
	var view connectionView
	if err := json.Unmarshal(raw, &view); err != nil {
		return connectionView{}, response.StatusCode, fmt.Errorf("企业连接信息无效")
	}
	return view, response.StatusCode, nil
}

func (s *Service) revokeRemote(apiKey string) error {
	request, err := http.NewRequest(http.MethodDelete, TokenBaseURL(s.origin)+"/beeftv/connection", nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	response, err := s.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<16))
	if response.StatusCode != http.StatusNoContent && response.StatusCode != http.StatusOK && response.StatusCode != http.StatusUnauthorized {
		return fmt.Errorf("断开企业连接失败")
	}
	return nil
}

func (s *Service) fetchModels(apiKey string) ([]CatalogModel, error) {
	if s.fetchCatalog != nil {
		return s.fetchCatalog(apiKey, ProviderBaseURL(s.origin))
	}
	request, err := http.NewRequest(http.MethodGet, TokenBaseURL(s.origin)+"/models", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Accept", "application/json")
	response, err := s.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("读取模型列表失败")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("读取模型列表失败")
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return nil, errRevoked
	}
	if response.StatusCode >= 300 {
		return nil, fmt.Errorf("读取模型列表失败")
	}
	var payload modelsPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("模型列表无效")
	}
	models := make([]CatalogModel, 0, len(payload.Data))
	seen := map[string]bool{}
	for _, item := range payload.Data {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			id = strings.TrimSpace(item.Name)
		}
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		models = append(models, CatalogModel{
			ID:                     id,
			DisplayName:            strings.TrimSpace(item.DisplayName),
			ModelType:              strings.ToLower(strings.TrimSpace(item.ModelType)),
			SupportedEndpointTypes: item.SupportedEndpointTypes,
		})
	}
	return models, nil
}

func parseOAuthError(raw []byte) string {
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil {
		var legacy oauthError
		if json.Unmarshal(raw, &legacy) == nil {
			return firstNonEmpty(legacy.Error, legacy.ErrorCode)
		}
		return ""
	}
	switch typed := payload["error"].(type) {
	case string:
		if typed != "" {
			return typed
		}
	case map[string]any:
		if code, _ := typed["code"].(string); code != "" {
			return code
		}
		if code, _ := typed["error"].(string); code != "" {
			return code
		}
	}
	if code, _ := payload["error_code"].(string); code != "" {
		return code
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func defaultHTTPClient() *http.Client {
	return &http.Client{Timeout: 20 * time.Second}
}

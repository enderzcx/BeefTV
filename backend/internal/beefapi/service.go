package beefapi

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"infinite-canvas/backend/internal/workspace"

	"github.com/pkg/browser"
)

var (
	errRevoked      = errors.New("BeefAPI 连接已失效，请重新连接")
	errNotConnected = errors.New("尚未连接 BeefAPI")
	errStore        = errors.New("保存连接失败，请重试")
)

type Options struct {
	DataDir       string
	Origin        string
	HTTPClient    *http.Client
	OpenURL       func(string) error
	Now           func() time.Time
	Sleep         func(time.Duration)
	Provider      *workspace.ProviderConfig
	ClientVersion string
	Hostname      string
	FetchCatalog  func(apiKey, baseURL string) ([]CatalogModel, error)
}

type Service struct {
	dataDir       string
	origin        string
	httpClient    *http.Client
	openURL       func(string) error
	now           func() time.Time
	sleep         func(time.Duration)
	provider      *workspace.ProviderConfig
	clientVersion string
	hostname      string
	fetchCatalog  func(apiKey, baseURL string) ([]CatalogModel, error)

	mu         sync.Mutex
	state      persistedState
	pollCancel context.CancelFunc
	closed     bool
}

func New(opts Options) (*Service, error) {
	origin, err := CanonicalOrigin(opts.Origin)
	if err != nil {
		return nil, err
	}
	dataDir := strings.TrimSpace(opts.DataDir)
	if dataDir == "" {
		return nil, errors.New("本地工作区数据目录不能为空")
	}
	httpClient := opts.HTTPClient
	if httpClient == nil {
		httpClient = defaultHTTPClient()
	}
	openURL := opts.OpenURL
	if openURL == nil {
		openURL = browser.OpenURL
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	sleep := opts.Sleep
	if sleep == nil {
		sleep = time.Sleep
	}
	hostname := strings.TrimSpace(opts.Hostname)
	if hostname == "" {
		hostname, _ = os.Hostname()
	}
	if hostname == "" {
		hostname = "BeefTV"
	}
	clientVersion := strings.TrimSpace(opts.ClientVersion)
	if clientVersion == "" {
		clientVersion = "dev"
	}
	state, err := loadState(dataDir)
	if err != nil {
		state = persistedState{SchemaVersion: connectionSchema, Status: StateStoreError, LastError: "读取已保存的连接失败", Balance: BalanceUnknown}
	}
	return &Service{
		dataDir: dataDir, origin: origin, httpClient: httpClient, openURL: openURL,
		now: now, sleep: sleep, provider: opts.Provider, clientVersion: clientVersion,
		hostname: hostname, fetchCatalog: opts.FetchCatalog, state: state,
	}, nil
}

func (s *Service) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	if s.pollCancel != nil {
		s.pollCancel()
		s.pollCancel = nil
	}
}

func (s *Service) Origin() string { return s.origin }

func (s *Service) Status() Summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.summaryLocked()
}

func (s *Service) HasManagedCredential() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.hasCredential()
}

func (s *Service) Resolve() (Credential, error) {
	s.mu.Lock()
	state := s.state
	s.mu.Unlock()
	if !state.hasCredential() {
		return Credential{}, errNotConnected
	}
	if state.Status == StateRevoked {
		return Credential{}, errRevoked
	}
	apiKey, err := decryptSecret(s.dataDir, state.EncryptedAPIKey)
	if err != nil {
		return Credential{}, errStore
	}
	if strings.TrimSpace(apiKey) == "" {
		return Credential{}, errNotConnected
	}
	accountID := ""
	if state.Account != nil {
		accountID = state.Account.ID
	}
	baseURL := state.ProviderBaseURL
	if baseURL == "" {
		baseURL = ProviderBaseURL(s.origin)
	}
	return Credential{APIKey: apiKey, BaseURL: baseURL, AccountID: accountID, TokenID: state.TokenID, KeyName: state.KeyName}, nil
}

func (s *Service) MarkRevoked() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.state.hasCredential() {
		return
	}
	s.state.Status = StateRevoked
	s.state.LastError = "连接已失效，请重新连接"
	_ = saveState(s.dataDir, s.state)
}

func (s *Service) MarkZeroBalance() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Balance = BalanceZero
	_ = saveState(s.dataDir, s.state)
}

func (s *Service) Start(ctx context.Context) (Summary, error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return Summary{}, errors.New("企业连接服务已关闭")
	}
	status := s.state.Status
	if status == StatePending && s.state.Device != nil && s.now().Before(parseTime(s.state.Device.ExpiresAt)) {
		summary := s.summaryLocked()
		s.mu.Unlock()
		return summary, nil
	}
	if status == StateConnected && s.state.hasCredential() && s.state.CatalogOK {
		summary := s.summaryLocked()
		s.mu.Unlock()
		return summary, nil
	}
	if s.state.hasCredential() && (status == StateCatalogFailed || (status == StateConnected && !s.state.CatalogOK) || (s.state.hasCredential() && !s.state.Acked)) {
		s.mu.Unlock()
		if err := s.finalizeSavedCredential(ctx); err == nil {
			return s.Status(), nil
		}
		s.mu.Lock()
		status = s.state.Status
		if status == StateConnected && s.state.CatalogOK {
			summary := s.summaryLocked()
			s.mu.Unlock()
			return summary, nil
		}
	}
	if s.pollCancel != nil {
		s.pollCancel()
		s.pollCancel = nil
	}
	s.mu.Unlock()

	device, err := s.requestDeviceCode()
	if err != nil {
		s.setError(StateStoreError, err.Error())
		return s.Status(), err
	}
	expiresAt := s.now().Add(time.Duration(device.ExpiresIn) * time.Second).UTC().Format(time.RFC3339Nano)
	s.mu.Lock()
	s.state.Status = StatePending
	s.state.LastError = ""
	s.state.Device = &persistedDevice{
		DeviceCode: device.DeviceCode, UserCode: device.UserCode,
		VerificationURI: device.VerificationURI, VerificationURIComplete: device.VerificationURIComplete,
		IntervalSeconds: device.Interval, ExpiresAt: expiresAt,
	}
	if err := saveState(s.dataDir, s.state); err != nil {
		s.state.Status = StateStoreError
		s.state.LastError = "保存连接失败，请重试"
		s.mu.Unlock()
		return s.Status(), errStore
	}
	pollCtx, cancel := context.WithCancel(context.Background())
	s.pollCancel = cancel
	summary := s.summaryLocked()
	s.mu.Unlock()

	openTarget := device.VerificationURIComplete
	if openTarget == "" {
		openTarget = device.VerificationURI
	}
	if err := s.openTrusted(openTarget); err != nil {
		s.setError(StatePending, "无法打开系统浏览器，请复制确认页地址")
	}
	go s.pollLoop(pollCtx, device.DeviceCode, time.Duration(device.Interval)*time.Second, parseTime(expiresAt))
	return summary, nil
}

func (s *Service) Cancel(ctx context.Context) (Summary, error) {
	s.mu.Lock()
	deviceCode := ""
	if s.state.Device != nil {
		deviceCode = s.state.Device.DeviceCode
	}
	if s.pollCancel != nil {
		s.pollCancel()
		s.pollCancel = nil
	}
	s.mu.Unlock()
	_ = s.cancelRemote(deviceCode)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.hasCredential() && s.state.Acked && s.state.Status == StateConnected {
		return s.summaryLocked(), nil
	}
	s.state.Status = StateCancelled
	s.state.Device = nil
	s.state.LastError = ""
	if !s.state.Acked {
		s.state.EncryptedAPIKey = ""
		s.state.CatalogOK = false
	}
	if err := saveState(s.dataDir, s.state); err != nil {
		s.state.Status = StateStoreError
		s.state.LastError = "保存连接失败，请重试"
		return s.summaryLocked(), errStore
	}
	return s.summaryLocked(), nil
}

func (s *Service) Disconnect(ctx context.Context) (Summary, error) {
	s.mu.Lock()
	if s.pollCancel != nil {
		s.pollCancel()
		s.pollCancel = nil
	}
	encrypted := s.state.EncryptedAPIKey
	s.mu.Unlock()
	if encrypted != "" {
		if apiKey, err := decryptSecret(s.dataDir, encrypted); err == nil && apiKey != "" {
			_ = s.revokeRemote(apiKey)
		}
	}
	if err := clearBeefAPIModels(s.provider); err != nil {
		s.setError(StateStoreError, "保存连接失败，请重试")
		return s.Status(), errStore
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = persistedState{SchemaVersion: connectionSchema, Status: StateDisconnected, Balance: BalanceUnknown}
	if err := saveState(s.dataDir, s.state); err != nil {
		s.state.Status = StateStoreError
		s.state.LastError = "保存连接失败，请重试"
		return s.summaryLocked(), errStore
	}
	return s.summaryLocked(), nil
}

func (s *Service) OpenWallet() error {
	return s.openTrusted(WalletURL(s.origin))
}

func (s *Service) Recover(ctx context.Context) error {
	s.mu.Lock()
	state := s.state
	s.mu.Unlock()
	if state.hasCredential() && (!state.Acked || !state.CatalogOK || state.Status == StateCatalogFailed) {
		return s.finalizeSavedCredential(ctx)
	}
	if state.Status == StatePending && state.Device != nil {
		expires := parseTime(state.Device.ExpiresAt)
		if s.now().After(expires) {
			s.setError(StateExpired, "授权已过期，请重新连接")
			return nil
		}
		s.mu.Lock()
		if s.pollCancel != nil {
			s.mu.Unlock()
			return nil
		}
		pollCtx, cancel := context.WithCancel(context.Background())
		s.pollCancel = cancel
		deviceCode := state.Device.DeviceCode
		interval := time.Duration(state.Device.IntervalSeconds) * time.Second
		s.mu.Unlock()
		go s.pollLoop(pollCtx, deviceCode, interval, expires)
	}
	if state.Status == StateConnected && state.hasCredential() {
		go s.verifyRemote()
	}
	return nil
}

func (s *Service) RedactConfig(config map[string]any) map[string]any {
	return RedactConfig(config, s.HasManagedCredential())
}

func (s *Service) PreserveWrite(incoming, existing map[string]any) {
	PreserveManagedChannel(incoming, existing, s.HasManagedCredential())
}

func (s *Service) pollLoop(ctx context.Context, deviceCode string, interval time.Duration, expiresAt time.Time) {
	if interval < time.Second {
		interval = 5 * time.Second
	}
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if !expiresAt.IsZero() && s.now().After(expiresAt) {
			s.setError(StateExpired, "授权已过期，请重新连接")
			return
		}
		token, code, err := s.pollToken(deviceCode)
		if err != nil {
			s.sleep(interval)
			continue
		}
		switch code {
		case "", "success":
			if strings.TrimSpace(token.APIKey) == "" {
				s.sleep(interval)
				continue
			}
			if err := s.acceptToken(ctx, deviceCode, token); err != nil {
				return
			}
			return
		case "authorization_pending":
			s.sleep(interval)
		case "slow_down":
			interval += 5 * time.Second
			s.sleep(interval)
		case "expired_token", "expired":
			s.setError(StateExpired, "授权已过期，请重新连接")
			return
		case "access_denied", "denied", "rejected":
			s.setError(StateRejected, "授权被拒绝")
			return
		default:
			s.sleep(interval)
		}
	}
}

func (s *Service) acceptToken(ctx context.Context, deviceCode string, token tokenSuccess) error {
	if err := ValidateReturnedBaseURL(s.origin, token.BaseURL); err != nil {
		s.setError(StateRejected, err.Error())
		return err
	}
	if strings.TrimSpace(token.Market) != "" && token.Market != "enterprise" {
		s.setError(StateRejected, "企业授权市场无效")
		return errors.New("企业授权市场无效")
	}
	if strings.TrimSpace(token.Group) != "" && token.Group != "enterprise" {
		s.setError(StateRejected, "企业授权分组无效")
		return errors.New("企业授权分组无效")
	}
	if strings.TrimSpace(token.Account.ID) == "" {
		s.setError(StateRejected, "企业账号无效")
		return errors.New("企业账号无效")
	}
	encrypted, err := encryptSecret(s.dataDir, token.APIKey)
	if err != nil {
		s.setError(StateStoreError, "保存连接失败，请重试")
		return errStore
	}
	s.mu.Lock()
	previousAccount := ""
	if s.state.Account != nil {
		previousAccount = s.state.Account.ID
	}
	account := token.Account
	s.state.EncryptedAPIKey = encrypted
	s.state.ProviderBaseURL = ProviderBaseURL(s.origin)
	s.state.Market = "enterprise"
	s.state.Group = "enterprise"
	s.state.Account = &account
	s.state.KeyName = token.KeyName
	s.state.TokenID = token.TokenID
	s.state.Acked = false
	s.state.CatalogOK = false
	s.state.Balance = BalanceUnknown
	s.state.LastError = ""
	if s.state.Device != nil {
		s.state.Device.DeviceCode = deviceCode
	}
	if err := saveState(s.dataDir, s.state); err != nil {
		s.state.Status = StateStoreError
		s.state.LastError = "保存连接失败，请重试"
		s.mu.Unlock()
		return errStore
	}
	s.mu.Unlock()
	_ = previousAccount
	return s.finalizeSavedCredential(ctx)
}

func (s *Service) finalizeSavedCredential(ctx context.Context) error {
	s.mu.Lock()
	state := s.state
	deviceCode := ""
	if state.Device != nil {
		deviceCode = state.Device.DeviceCode
	}
	previousAccount := ""
	if state.Account != nil {
		previousAccount = state.Account.ID
	}
	s.mu.Unlock()
	if !state.hasCredential() {
		return errNotConnected
	}
	apiKey, err := decryptSecret(s.dataDir, state.EncryptedAPIKey)
	if err != nil {
		s.setError(StateStoreError, "保存连接失败，请重试")
		return errStore
	}
	if !state.Acked && deviceCode != "" {
		if err := s.acknowledge(deviceCode); err != nil {
			// Local save already succeeded; keep retrying acknowledgement on recover.
			s.mu.Lock()
			s.state.LastError = "正在完成连接确认"
			_ = saveState(s.dataDir, s.state)
			s.mu.Unlock()
		} else {
			s.mu.Lock()
			s.state.Acked = true
			_ = saveState(s.dataDir, s.state)
			s.mu.Unlock()
		}
	}
	models, err := s.fetchModels(apiKey)
	if err != nil {
		if errors.Is(err, errRevoked) {
			s.MarkRevoked()
			return errRevoked
		}
		s.mu.Lock()
		s.state.Status = StateCatalogFailed
		s.state.CatalogOK = false
		s.state.LastError = "模型列表读取失败，请重试"
		_ = saveState(s.dataDir, s.state)
		s.mu.Unlock()
		return err
	}
	nextAccount := previousAccount
	if state.Account != nil {
		nextAccount = state.Account.ID
	}
	if err := applyCatalog(s.provider, models, previousAccount, nextAccount); err != nil {
		s.setError(StateCatalogFailed, "模型列表读取失败，请重试")
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.CatalogOK = true
	s.state.Status = StateConnected
	s.state.LastError = ""
	if s.state.Acked {
		s.state.Device = nil
	}
	if s.state.ConnectedAt == "" {
		s.state.ConnectedAt = s.now().UTC().Format(time.RFC3339Nano)
	}
	if err := saveState(s.dataDir, s.state); err != nil {
		s.state.Status = StateStoreError
		s.state.LastError = "保存连接失败，请重试"
		return errStore
	}
	return nil
}

func (s *Service) verifyRemote() {
	cred, err := s.Resolve()
	if err != nil {
		return
	}
	_, status, err := s.remoteConnection(cred.APIKey)
	if err != nil {
		return
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		s.MarkRevoked()
	}
}

func (s *Service) openTrusted(raw string) error {
	target := strings.TrimSpace(raw)
	if target == "" {
		target = WalletURL(s.origin)
	}
	parsed, err := ValidateWalletURL(s.origin, target)
	if err != nil {
		if parsed, err = ValidateVerificationURL(s.origin, target); err != nil {
			return err
		}
	}
	return s.openURL(parsed.String())
}

func (s *Service) setError(status, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Status = status
	s.state.LastError = message
	if status != StatePending {
		if s.pollCancel != nil {
			s.pollCancel()
			s.pollCancel = nil
		}
	}
	_ = saveState(s.dataDir, s.state)
}

func (s *Service) summaryLocked() Summary {
	summary := Summary{
		State:         s.state.Status,
		Market:        s.state.Market,
		KeyName:       s.state.KeyName,
		TokenID:       s.state.TokenID,
		Balance:       s.state.Balance,
		ErrorReason:   s.state.LastError,
		ConnectedAt:   s.state.ConnectedAt,
		HasCredential: s.state.hasCredential(),
		CatalogFailed: s.state.Status == StateCatalogFailed || (s.state.hasCredential() && !s.state.CatalogOK && s.state.Status != StatePending),
	}
	if s.state.hasCredential() {
		summary.CredentialRef = CredentialRef
		summary.WalletURL = WalletURL(s.origin)
		if s.state.Account != nil {
			account := *s.state.Account
			summary.Account = &account
		}
	}
	if s.state.Device != nil && s.state.Status == StatePending {
		summary.UserCode = s.state.Device.UserCode
		summary.VerificationURI = s.state.Device.VerificationURIComplete
		if summary.VerificationURI == "" {
			summary.VerificationURI = s.state.Device.VerificationURI
		}
		summary.ExpiresAt = s.state.Device.ExpiresAt
	}
	if summary.State == "" {
		summary.State = StateDisconnected
	}
	return summary
}

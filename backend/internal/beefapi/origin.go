package beefapi

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

const (
	ProductionOrigin = "https://enterprise.beefapi.com"
	ClientID         = "beeftv-enterprise-v1"
	ClientScope      = "inference"
	CredentialRef    = "beefapi-enterprise"
	ChannelID        = "beefapi"
	TestOriginEnv    = "BEEFTV_ENTERPRISE_TEST_ORIGIN"
)

// CanonicalOrigin is the immutable production enterprise origin unless an
// explicit loopback test origin is configured for local verification.
func CanonicalOrigin(explicit string) (string, error) {
	candidate := strings.TrimRight(strings.TrimSpace(explicit), "/")
	if candidate == "" {
		candidate = strings.TrimRight(strings.TrimSpace(os.Getenv(TestOriginEnv)), "/")
	}
	if candidate == "" || strings.EqualFold(candidate, ProductionOrigin) {
		return ProductionOrigin, nil
	}
	origin, err := parseSafeTestOrigin(candidate)
	if err != nil {
		return "", err
	}
	return origin, nil
}

func parseSafeTestOrigin(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("测试企业源地址无效")
	}
	if parsed.User != nil || parsed.Opaque != "" || strings.Trim(parsed.Path, "/") != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("测试企业源地址只能是 loopback 源")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("测试企业源地址只支持 HTTP 或 HTTPS")
	}
	host := parsed.Hostname()
	if !isLoopbackHost(host) {
		return "", fmt.Errorf("测试企业源地址只允许 127.0.0.1 或 localhost")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

func isLoopbackHost(host string) bool {
	switch strings.ToLower(strings.TrimSpace(host)) {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func ProviderBaseURL(origin string) string {
	return strings.TrimRight(strings.TrimSpace(origin), "/")
}

func TokenBaseURL(origin string) string {
	return ProviderBaseURL(origin) + "/v1"
}

func WalletURL(origin string) string {
	return ProviderBaseURL(origin) + "/"
}

func ValidateReturnedBaseURL(origin, baseURL string) error {
	normalized := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if normalized != TokenBaseURL(origin) {
		return fmt.Errorf("企业接口返回的服务地址无效")
	}
	return nil
}

func ValidateVerificationURL(origin, raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("授权地址无效")
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("授权地址无效")
	}
	if !strings.EqualFold(parsed.Scheme+"://"+parsed.Host, origin) {
		return nil, fmt.Errorf("授权地址不属于当前企业源")
	}
	path := parsed.EscapedPath()
	if path != "/desktop-auth" && !strings.HasPrefix(path, "/desktop-auth/") {
		return nil, fmt.Errorf("授权地址不在允许的确认页")
	}
	return parsed, nil
}

func ValidateWalletURL(origin, raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("钱包地址无效")
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("钱包地址无效")
	}
	if !strings.EqualFold(parsed.Scheme+"://"+parsed.Host, origin) {
		return nil, fmt.Errorf("钱包地址不属于当前企业源")
	}
	return parsed, nil
}

func IsManagedChannel(channelID, credentialRef, baseURL string) bool {
	if strings.TrimSpace(credentialRef) == CredentialRef {
		return true
	}
	if strings.TrimSpace(channelID) == ChannelID {
		return true
	}
	return IsEnterpriseBaseURL(baseURL)
}

func IsEnterpriseBaseURL(baseURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "enterprise.beefapi.com"
}

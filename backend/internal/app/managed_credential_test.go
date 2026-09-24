package app

import (
	"testing"

	"infinite-canvas/backend/internal/beefapi"
)

func TestResolveManagedBeefAPISecretsUsesStoredKeyAndDropsClientSentinel(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	if err := s.SaveLocalModelConfig([]byte(`{"channels":[{"id":"beefapi","baseUrl":"https://enterprise.beefapi.com","apiKey":"disk-secret","enabled":true,"models":["text-local"]}]}`)); err != nil {
		t.Fatal(err)
	}
	input := map[string]any{"config": map[string]any{"channelId": "beefapi", "credentialRef": beefapi.CredentialRef, "apiKey": "from-webview", "baseUrl": "https://enterprise.beefapi.com", "model": "text-local"}}
	resolved, err := s.resolveManagedBeefAPISecrets(input)
	if err != nil {
		t.Fatal(err)
	}
	config := resolved["config"].(map[string]any)
	if config["apiKey"] != "disk-secret" {
		t.Fatalf("apiKey = %#v", config["apiKey"])
	}
	if _, exists := config["channelId"]; exists {
		t.Fatalf("system channel id leaked: %#v", config)
	}
	if config["credentialRef"] != beefapi.CredentialRef {
		t.Fatalf("credentialRef = %#v", config["credentialRef"])
	}
}

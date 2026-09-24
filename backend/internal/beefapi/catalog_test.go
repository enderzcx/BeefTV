package beefapi

import (
	"testing"

	"infinite-canvas/backend/internal/workspace"
)

func TestCatalogCapabilityMapsBeefAPIEndpointTypes(t *testing.T) {
	cases := []struct {
		endpoints []string
		wantCap   string
		wantProto string
	}{
		{[]string{"openai"}, "text", "chat-completion"},
		{[]string{"openai-response"}, "text", "openai-response"},
		{[]string{"openai-response-compact"}, "text", "openai-response"},
		{[]string{"anthropic"}, "text", "claude-api"},
		{[]string{"gemini"}, "text", "google-gemini-generate-content"},
		{[]string{"image-generation"}, "image", "openai-image"},
		{[]string{"openai-video"}, "video", "openai-videos"},
		{[]string{"openai", "image-generation"}, "image", "openai-image"},
	}
	for _, test := range cases {
		capability, protocol := catalogCapabilityAndProtocol(CatalogModel{SupportedEndpointTypes: test.endpoints})
		if capability != test.wantCap || protocol != test.wantProto {
			t.Fatalf("%v -> capability=%q protocol=%q", test.endpoints, capability, protocol)
		}
	}
}

func TestApplyCatalogReplacesModelsOnAccountSwitch(t *testing.T) {
	store, err := workspace.NewProviderConfig(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	first := []CatalogModel{{ID: "model-a", SupportedEndpointTypes: []string{"image-generation"}}, {ID: "model-b", SupportedEndpointTypes: []string{"openai-video"}}}
	if err := applyCatalog(store, first, "", "42"); err != nil {
		t.Fatal(err)
	}
	second := []CatalogModel{{ID: "model-b", SupportedEndpointTypes: []string{"openai-video"}}, {ID: "model-c", SupportedEndpointTypes: []string{"openai"}}}
	if err := applyCatalog(store, second, "42", "99"); err != nil {
		t.Fatal(err)
	}
	effective, _, err := store.LoadEffectiveModelConfig()
	if err != nil {
		t.Fatal(err)
	}
	channel := findChannel(effective.Config["channels"].([]any), ChannelID)
	ids := map[string]bool{}
	switch models := channel["models"].(type) {
	case []any:
		for _, item := range models {
			ids[item.(string)] = true
		}
	case []string:
		for _, item := range models {
			ids[item] = true
		}
	}
	if ids["model-a"] || !ids["model-b"] || !ids["model-c"] {
		t.Fatalf("account switch merged stale models: %#v", channel["models"])
	}
	profiles, _ := channel["modelProfiles"].([]any)
	foundProtocol := false
	for _, raw := range profiles {
		profile, _ := raw.(map[string]any)
		if profile["model"] == "model-c" && profile["capability"] == "text" && profile["protocol"] == "chat-completion" {
			foundProtocol = true
		}
	}
	if !foundProtocol {
		t.Fatalf("missing mapped protocol: %#v", profiles)
	}
}

package app

import "testing"

func TestBeefAPIMCPCatalogPreservesExistingModels(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	if err := s.SaveLocalModelConfig([]byte(`{"channels":[{"id":"beefapi","models":["enterprise-image"],"modelProfiles":[{"model":"enterprise-image","capability":"image"}]}]}`)); err != nil {
		t.Fatal(err)
	}
	// cloudAgentModelList returns []map[string]any, not []any.
	catalog := s.appendLocalBeefAPIModels(map[string]any{"models": []map[string]any{{"name": "existing-model"}}}, nil)
	models := catalog.(map[string]any)["models"].([]map[string]any)
	found := map[string]bool{}
	for _, item := range models {
		found[item["name"].(string)] = true
	}
	if !found["existing-model"] || !found["enterprise-image"] {
		t.Fatalf("adding enterprise catalog removed existing selection: %v", found)
	}
}

func TestBeefAPIMCPListedSelectionCanEnterMediaApproval(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	if err := s.SaveLocalModelConfig([]byte(`{"channels":[{"id":"beefapi","baseUrl":"https://enterprise.beefapi.com","apiKey":"test-key","enabled":true,"models":["enterprise-image"],"modelProfiles":[{"model":"enterprise-image","capability":"image","protocol":"openai-image"}]}]}`)); err != nil {
		t.Fatal(err)
	}
	catalog := s.appendLocalBeefAPIModels(map[string]any{"models": []any{}}, nil)
	models := catalog.(map[string]any)["models"].([]map[string]any)
	if len(models) != 1 {
		t.Fatalf("expected enterprise selection, got %d models", len(models))
	}
	item := models[0]
	selection := item["selection"].(map[string]any)
	_, err := s.cloudAgentMediaModelName(cloudAgentMediaArgs{
		Mode: "image", ChannelID: selection["channelId"].(string), ChannelModelKey: selection["channelModelKey"].(string),
	})
	if err != nil {
		t.Fatalf("MCP-listed selection is rejected by actual media approval: %v", err)
	}
}

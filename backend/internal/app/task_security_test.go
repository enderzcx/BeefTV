package app

import (
	"strings"
	"testing"
)

func TestNormalizeTaskInputStillAllowsSecretProtection(t *testing.T) {
	input, err := normalizeTaskInput(map[string]any{
		"config": providerConfig{BaseURL: "https://example.com", APIKey: "private-key", Model: "text-model"},
	})
	if err != nil {
		t.Fatal(err)
	}
	config, ok := input["config"].(map[string]any)
	if !ok || config["apiKey"] != "private-key" {
		t.Fatalf("normalized config = %#v", input["config"])
	}
	svc := &Service{dataDir: t.TempDir()}
	if err := svc.protectTaskSecrets(input); err != nil {
		t.Fatal(err)
	}
	protected, _ := config["apiKey"].(string)
	if protected == "private-key" || !strings.HasPrefix(protected, encryptedSettingPrefix) {
		t.Fatalf("protected apiKey = %q", protected)
	}
}

func TestTaskInputRejectsInlineMedia(t *testing.T) {
	input, err := normalizeTaskInput(map[string]any{
		"referenceImages": []providerMedia{{DataURL: testReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !containsInlineMediaDataURL(input) {
		t.Fatal("containsInlineMediaDataURL() = false")
	}
}

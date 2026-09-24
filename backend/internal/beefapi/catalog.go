package beefapi

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/workspace"
)

func applyCatalog(store *workspace.ProviderConfig, models []CatalogModel, previousAccountID, nextAccountID string) error {
	if store == nil {
		return nil
	}
	effective, _, err := store.LoadEffectiveModelConfig()
	if err != nil {
		return err
	}
	config, err := cloneAnyMap(effective.Config)
	if err != nil {
		return err
	}
	channels, _ := config["channels"].([]any)
	replaced := false
	replaceModels := previousAccountID != "" && nextAccountID != "" && previousAccountID != nextAccountID
	nextModels := make([]any, 0, len(models))
	nextProfiles := make([]any, 0, len(models))
	for _, model := range models {
		nextModels = append(nextModels, model.ID)
		profile := map[string]any{"model": model.ID}
		if model.DisplayName != "" {
			profile["displayName"] = model.DisplayName
		}
		capability, protocol := catalogCapabilityAndProtocol(model)
		if capability != "" {
			profile["capability"] = capability
		}
		if protocol != "" {
			profile["protocol"] = protocol
		}
		nextProfiles = append(nextProfiles, profile)
	}
	for index, raw := range channels {
		channel, ok := raw.(map[string]any)
		if !ok || channel["id"] != ChannelID {
			continue
		}
		if replaceModels {
			channel["models"] = nextModels
			channel["modelProfiles"] = nextProfiles
		} else {
			channel["models"] = mergeModelIDs(channel["models"], nextModels)
			channel["modelProfiles"] = mergeProfiles(channel["modelProfiles"], nextProfiles)
		}
		channel["apiKey"] = ""
		channel["credentialRef"] = CredentialRef
		channels[index] = channel
		replaced = true
		break
	}
	if !replaced {
		channels = append([]any{map[string]any{
			"id": ChannelID, "models": nextModels, "modelProfiles": nextProfiles,
			"apiKey": "", "credentialRef": CredentialRef, "enabled": true,
		}}, channels...)
	}
	config["channels"] = channels
	body, err := json.Marshal(config)
	if err != nil {
		return err
	}
	return store.SaveLocalModelConfig(body)
}

func clearBeefAPIModels(store *workspace.ProviderConfig) error {
	if store == nil {
		return nil
	}
	effective, _, err := store.LoadEffectiveModelConfig()
	if err != nil {
		return err
	}
	config, err := cloneAnyMap(effective.Config)
	if err != nil {
		return err
	}
	channels, _ := config["channels"].([]any)
	for index, raw := range channels {
		channel, ok := raw.(map[string]any)
		if !ok || channel["id"] != ChannelID {
			continue
		}
		channel["models"] = []any{}
		channel["modelProfiles"] = []any{}
		channel["apiKey"] = ""
		delete(channel, "credentialRef")
		channels[index] = channel
	}
	config["channels"] = channels
	body, err := json.Marshal(config)
	if err != nil {
		return err
	}
	return store.SaveLocalModelConfig(body)
}

func catalogCapability(model CatalogModel) string {
	capability, _ := catalogCapabilityAndProtocol(model)
	return capability
}

func catalogProtocol(model CatalogModel) string {
	_, protocol := catalogCapabilityAndProtocol(model)
	return protocol
}

func catalogCapabilityAndProtocol(model CatalogModel) (capability, protocol string) {
	id := strings.ToLower(strings.TrimSpace(model.ID))
	modelType := strings.ToLower(strings.TrimSpace(model.ModelType))
	endpoints := make([]string, 0, len(model.SupportedEndpointTypes))
	for _, endpoint := range model.SupportedEndpointTypes {
		if item := strings.ToLower(strings.TrimSpace(endpoint)); item != "" {
			endpoints = append(endpoints, item)
		}
	}
	if catalogIsTranscription(id, endpoints) {
		return "", ""
	}
	type mapping struct {
		capability string
		protocol   string
		endpoints  []string
	}
	for _, item := range []mapping{
		{capability: "image", protocol: "openai-image", endpoints: []string{"image-generation", "images", "images.generations"}},
		{capability: "video", protocol: "openai-videos", endpoints: []string{"openai-video", "videos", "videos.generations"}},
		{capability: "audio", protocol: "openai-audio", endpoints: []string{"audio.speech", "audio-speech"}},
		{capability: "text", protocol: "openai-response", endpoints: []string{"openai-response", "openai-response-compact", "responses"}},
		{capability: "text", protocol: "claude-api", endpoints: []string{"anthropic", "messages"}},
		{capability: "text", protocol: "google-gemini-generate-content", endpoints: []string{"gemini"}},
	} {
		if containsAnyString(endpoints, item.endpoints) {
			return item.capability, item.protocol
		}
	}
	// BeefAPI /v1/models often lists speech/music with the generic "openai"
	// chat endpoint type. Those models still speak POST /v1/audio/speech.
	if catalogIsSpeechOrMusic(id) || modelType == "audio" {
		return "audio", "openai-audio"
	}
	if containsAnyString(endpoints, []string{"openai", "chat.completions"}) || modelType == "text" {
		return "text", "chat-completion"
	}
	switch modelType {
	case "image":
		return "image", "openai-image"
	case "video":
		return "video", "openai-videos"
	}
	return "", ""
}

func catalogIsTranscription(id string, endpoints []string) bool {
	if containsAnyString(endpoints, []string{"audio.transcriptions", "audio-transcriptions", "transcriptions"}) {
		return true
	}
	return strings.Contains(id, "asr") || strings.Contains(id, "transcri") || strings.Contains(id, "whisper") || strings.Contains(id, "stt")
}

func catalogIsSpeechOrMusic(id string) bool {
	if catalogIsTranscription(id, nil) {
		return false
	}
	return strings.Contains(id, "speech") || strings.Contains(id, "tts") || strings.Contains(id, "music")
}

func containsAnyString(values, candidates []string) bool {
	seen := map[string]bool{}
	for _, value := range values {
		seen[value] = true
	}
	for _, candidate := range candidates {
		if seen[candidate] {
			return true
		}
	}
	return false
}

func mergeModelIDs(existing any, incoming []any) []any {
	seen := map[string]bool{}
	result := make([]any, 0)
	appendID := func(value any) {
		id, _ := value.(string)
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		result = append(result, id)
	}
	switch items := existing.(type) {
	case []any:
		for _, item := range items {
			appendID(item)
		}
	case []string:
		for _, item := range items {
			appendID(item)
		}
	}
	for _, item := range incoming {
		appendID(item)
	}
	return result
}

func mergeProfiles(existing any, incoming []any) []any {
	byModel := map[string]map[string]any{}
	order := make([]string, 0)
	add := func(value any) {
		profile, ok := value.(map[string]any)
		if !ok {
			return
		}
		model, _ := profile["model"].(string)
		if strings.TrimSpace(model) == "" {
			return
		}
		if _, ok := byModel[model]; !ok {
			order = append(order, model)
		}
		merged := map[string]any{}
		for key, child := range byModel[model] {
			merged[key] = child
		}
		for key, child := range profile {
			merged[key] = child
		}
		byModel[model] = merged
	}
	if items, ok := existing.([]any); ok {
		for _, item := range items {
			add(item)
		}
	}
	for _, item := range incoming {
		add(item)
	}
	result := make([]any, 0, len(order))
	for _, model := range order {
		result = append(result, byModel[model])
	}
	return result
}

func cloneAnyMap(value map[string]any) (map[string]any, error) {
	if value == nil {
		return map[string]any{}, nil
	}
	body, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var clone map[string]any
	if err := json.Unmarshal(body, &clone); err != nil {
		return nil, err
	}
	return clone, nil
}

func RedactConfig(config map[string]any, managed bool) map[string]any {
	if config == nil {
		return config
	}
	redacted, err := cloneAnyMap(config)
	if err != nil {
		return config
	}
	channels, _ := redacted["channels"].([]any)
	for index, raw := range channels {
		channel, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id, _ := channel["id"].(string)
		if id != ChannelID {
			continue
		}
		apiKey, _ := channel["apiKey"].(string)
		secretKey, _ := channel["secretKey"].(string)
		hasKey := strings.TrimSpace(apiKey) != "" || strings.TrimSpace(secretKey) != "" || managed
		channel["apiKey"] = ""
		channel["secretKey"] = ""
		if managed {
			channel["credentialRef"] = CredentialRef
			channel["hasApiKey"] = true
		} else if hasKey {
			channel["hasApiKey"] = true
		}
		delete(channel, "encryptedApiKey")
		delete(channel, "deviceCode")
		delete(channel, "device_code")
		channels[index] = channel
	}
	redacted["channels"] = channels
	return redacted
}

func PreserveManagedChannel(incoming, existing map[string]any, managed bool) {
	if incoming == nil {
		return
	}
	incomingChannels, _ := incoming["channels"].([]any)
	existingChannels, _ := existing["channels"].([]any)
	existingBeef := findChannel(existingChannels, ChannelID)
	found := false
	for index, raw := range incomingChannels {
		channel, ok := raw.(map[string]any)
		if !ok || channel["id"] != ChannelID {
			continue
		}
		found = true
		delete(channel, "deviceCode")
		delete(channel, "device_code")
		delete(channel, "encryptedApiKey")
		if existingBeef != nil {
			channel["models"] = existingBeef["models"]
			channel["modelProfiles"] = existingBeef["modelProfiles"]
			if baseURL, _ := existingBeef["baseUrl"].(string); strings.TrimSpace(baseURL) != "" {
				channel["baseUrl"] = existingBeef["baseUrl"]
			}
		}
		if managed {
			channel["apiKey"] = ""
			channel["secretKey"] = ""
			channel["credentialRef"] = CredentialRef
		} else if existingBeef != nil {
			incomingKey, _ := channel["apiKey"].(string)
			if incomingKey == "" || incomingKey == workspace.RedactedSecret {
				if previous, ok := existingBeef["apiKey"]; ok {
					channel["apiKey"] = previous
				}
			}
			incomingSecret, _ := channel["secretKey"].(string)
			if incomingSecret == "" || incomingSecret == workspace.RedactedSecret {
				if previous, ok := existingBeef["secretKey"]; ok {
					channel["secretKey"] = previous
				}
			}
		}
		incomingChannels[index] = channel
	}
	if !found && existingBeef != nil {
		cloned, err := cloneAnyMap(existingBeef)
		if err == nil {
			delete(cloned, "deviceCode")
			delete(cloned, "device_code")
			delete(cloned, "encryptedApiKey")
			if managed {
				cloned["apiKey"] = ""
				cloned["secretKey"] = ""
				cloned["credentialRef"] = CredentialRef
			}
			incomingChannels = append([]any{cloned}, incomingChannels...)
		}
	}
	incoming["channels"] = incomingChannels
}

func findChannel(channels []any, id string) map[string]any {
	for _, raw := range channels {
		channel, ok := raw.(map[string]any)
		if ok && channel["id"] == id {
			return channel
		}
	}
	return nil
}

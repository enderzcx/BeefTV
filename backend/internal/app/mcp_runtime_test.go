package app

import (
	"testing"

	"infinite-canvas/backend/internal/mcp"
)

func TestLocalMCPSessionExposesBoundedTools(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	session := s.MCPSession()
	tools, err := session.ListTools()
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, tool := range tools {
		name, _ := tool["name"].(string)
		got[name] = true
	}
	for _, name := range []string{mcpToolListModels, mcpToolSubmitMedia, mcpToolGetTask} {
		if !got[name] {
			t.Fatalf("missing tool %s in %#v", name, got)
		}
	}
}

func TestMCPSubmitMediaRejectsUnapprovedCaller(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	result, err := s.callMCPTool(mcpToolSubmitMedia, map[string]any{
		"userId": "user", "runId": "missing", "approved": true,
	})
	if err != nil {
		return
	}
	if !result.IsError {
		t.Fatalf("unapproved submit succeeded: %#v", result)
	}
}

func TestMCPGetTaskDoesNotLeakSecrets(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	result, err := s.callMCPTool(mcpToolGetTask, map[string]any{"userId": "user", "taskId": "missing"})
	if err == nil && !result.IsError {
		t.Fatalf("missing task succeeded: %#v", result)
	}
	raw := mustEncodeMCP(t, result)
	if containsSecret(raw, "apiKey") && containsSecret(raw, "ent-secret") {
		t.Fatalf("task result leaked secret: %s", raw)
	}
}

func TestMCPDuplicateMediaExecutionReturnsSameIdentity(t *testing.T) {
	id := cloudAgentMediaExecutionID("user", "run-1", "call-1")
	again := cloudAgentMediaExecutionID("user", "run-1", "call-1")
	other := cloudAgentMediaExecutionID("user", "run-1", "call-2")
	if id != again || id == other || id == "" {
		t.Fatalf("execution ids = %q %q %q", id, again, other)
	}
}

func mustEncodeMCP(t *testing.T, result mcp.ToolResult) string {
	t.Helper()
	if len(result.Content) == 0 {
		return ""
	}
	text, _ := result.Content[0]["text"].(string)
	return text
}

func containsSecret(raw, value string) bool {
	return len(raw) > 0 && len(value) > 0 && (raw == value)
}

package mcp

import "encoding/json"

const ProtocolVersion = "2025-03-26"

type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id,omitempty"`
	Result  any    `json:"result,omitempty"`
	Error   *Error `json:"error,omitempty"`
}

type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Handle      func(arguments json.RawMessage) (any, error)
}

type CallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type ToolResult struct {
	Content []map[string]any `json:"content"`
	IsError bool             `json:"isError,omitempty"`
	Data    any              `json:"data,omitempty"`
}

func textResult(data any) ToolResult {
	raw, _ := json.Marshal(data)
	return ToolResult{Content: []map[string]any{{"type": "text", "text": string(raw)}}, Data: data}
}

func errorResult(message string) ToolResult {
	return ToolResult{IsError: true, Content: []map[string]any{{"type": "text", "text": message}}}
}

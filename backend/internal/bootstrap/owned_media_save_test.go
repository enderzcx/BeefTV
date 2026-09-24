package bootstrap

import (
	"strings"
	"testing"
)

func TestSanitizeOwnedResourceIDRejectsTraversalAndURLs(t *testing.T) {
	for _, id := range []string{"", "../secret", "a/b", `a\b`, "http://example.com/x", "resource:abc", "abc def", strings.Repeat("a", 129)} {
		if _, err := sanitizeOwnedResourceID(id); err == nil {
			t.Fatalf("sanitizeOwnedResourceID(%q) succeeded", id)
		}
	}
	got, err := sanitizeOwnedResourceID("  abcdef0123456789  ")
	if err != nil {
		t.Fatal(err)
	}
	if got != "abcdef0123456789" {
		t.Fatalf("id = %q", got)
	}
}

func TestSanitizeSaveFileNameStripsPathsAndIllegalCharacters(t *testing.T) {
	got := sanitizeSaveFileName(`../evil:name?.mp4`)
	if strings.ContainsAny(got, `\/:*?"<>|`) || strings.Contains(got, "..") || !strings.HasSuffix(got, ".mp4") {
		t.Fatalf("sanitizeSaveFileName() = %q", got)
	}
	if got := sanitizeSaveFileName(" /tmp/clip.mp4 "); got != "clip.mp4" {
		t.Fatalf("basename = %q", got)
	}
	if got := sanitizeSaveFileName(".."); got != "未命名媒体" {
		t.Fatalf("dot name = %q", got)
	}
}

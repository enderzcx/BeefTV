package beefapi

import (
	"testing"
)

func TestCanonicalOriginDefaultsToProduction(t *testing.T) {
	t.Setenv(TestOriginEnv, "")
	origin, err := CanonicalOrigin("")
	if err != nil {
		t.Fatal(err)
	}
	if origin != ProductionOrigin {
		t.Fatalf("origin = %q", origin)
	}
}

func TestCanonicalOriginRejectsPublicTestOverride(t *testing.T) {
	t.Setenv(TestOriginEnv, "https://evil.example")
	if _, err := CanonicalOrigin(""); err == nil {
		t.Fatal("public override must be rejected")
	}
}

func TestCanonicalOriginAllowsLoopback(t *testing.T) {
	origin, err := CanonicalOrigin("http://127.0.0.1:8765")
	if err != nil {
		t.Fatal(err)
	}
	if origin != "http://127.0.0.1:8765" {
		t.Fatalf("origin = %q", origin)
	}
}

func TestValidateVerificationURLRejectsOtherHosts(t *testing.T) {
	if _, err := ValidateVerificationURL(ProductionOrigin, "https://example.com/desktop-auth"); err == nil {
		t.Fatal("expected host mismatch")
	}
	if _, err := ValidateVerificationURL(ProductionOrigin, ProductionOrigin+"/login"); err == nil {
		t.Fatal("expected path mismatch")
	}
	if _, err := ValidateVerificationURL(ProductionOrigin, ProductionOrigin+"/desktop-auth?user_code=ABCD"); err != nil {
		t.Fatal(err)
	}
}

func TestValidateReturnedBaseURLRequiresCanonicalV1(t *testing.T) {
	if err := ValidateReturnedBaseURL(ProductionOrigin, ProductionOrigin+"/v1"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateReturnedBaseURL(ProductionOrigin, ProductionOrigin+"/v1/"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateReturnedBaseURL(ProductionOrigin, ProductionOrigin+"/v1/v1"); err == nil {
		t.Fatal("double /v1 must be rejected")
	}
}

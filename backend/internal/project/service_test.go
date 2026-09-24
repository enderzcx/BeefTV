package project

import (
	"testing"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/model"
)

type fakeBackend struct{ projects []app.ProjectSummary }

func (f fakeBackend) ListProjects(string) ([]app.ProjectSummary, error) { return f.projects, nil }

func TestServiceRejectsInvalidProjectRevision(t *testing.T) {
	svc := New(fakeBackend{projects: []app.ProjectSummary{{Project: model.Project{ID: "p", Revision: 0}}}})
	if _, err := svc.ListProjects("local"); err == nil {
		t.Fatal("project without a durable revision was accepted")
	}
}

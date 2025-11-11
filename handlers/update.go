package handlers

import (
	"OnlySats/com"
	"OnlySats/config"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type UpdateHandler struct {
	Cfg      *config.AppConfig
	Pass     *config.PassConfig
	Cooldown time.Duration

	lastRun  time.Time
	inFlight bool
}
type RepopulateHandler struct {
	Cfg      *config.AppConfig
	Pass     *config.PassConfig
	Cooldown time.Duration

	lastRun  time.Time
	inFlight bool
}

type updateResp struct {
	Updated     bool   `json:"updated"`
	InProgress  bool   `json:"in_progress,omitempty"`
	CooldownSec int64  `json:"cooldown_sec,omitempty"`
	Message     string `json:"message,omitempty"`
	StartedAt   string `json:"started_at,omitempty"`
	DurationMs  int64  `json:"duration_ms,omitempty"`
	Step        string `json:"step,omitempty"`
}

func (h *UpdateHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, http.StatusMethodNotAllowed, updateResp{
			Message: "method not allowed",
		})
		return
	}

	// Basic preflight checks
	if h == nil || h.Cfg == nil {
		writeJSON(w, http.StatusInternalServerError, updateResp{
			Message: "server misconfigured: nil AppConfig",
			Step:    "preflight",
		})
		return
	}
	if h.Pass == nil {
		writeJSON(w, http.StatusInternalServerError, updateResp{
			Message: "server misconfigured: nil PassConfig",
			Step:    "preflight",
		})
		return
	}

	// Cooldown / in-flight gate
	now := time.Now()
	cool := h.Cooldown
	if cool <= 0 {
		cool = time.Minute
	}
	if h.inFlight {
		writeJSON(w, http.StatusTooManyRequests, updateResp{
			Message:    "update already in progress",
			InProgress: true,
			Step:       "gate",
		})
		return
	}
	if since := now.Sub(h.lastRun); since < cool {
		remain := int64((cool - since).Seconds() + 0.5)
		writeJSON(w, http.StatusTooManyRequests, updateResp{
			Message:     "cooldown active",
			CooldownSec: remain,
			Step:        "gate",
		})
		return
	}

	// Reserve slot
	h.inFlight = true
	start := time.Now()

	// clear the inFlight flag and set lastRun on success
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("[/api/update] panic: %v", rec)
			h.inFlight = false
		}
	}()

	// Context with a reasonable timeout to prevent hangs
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()

	// DB update (incremental)
	if err := h.runDBUpdate(ctx); err != nil {
		h.inFlight = false
		writeJSON(w, http.StatusInternalServerError, updateResp{
			Updated:   false,
			Message:   fmt.Sprintf("db-update failed: %v", err),
			StartedAt: start.UTC().Format(time.RFC3339),
			Step:      "db-update",
		})
		return
	}

	// Thumbnail generation
	if err := h.runThumbgen(ctx); err != nil {
		h.inFlight = false
		writeJSON(w, http.StatusInternalServerError, updateResp{
			Updated:   false,
			Message:   fmt.Sprintf("thumbgen failed: %v", err),
			StartedAt: start.UTC().Format(time.RFC3339),
			Step:      "thumbgen",
		})
		return
	}

	// Big Success!!      !!
	h.lastRun = time.Now()
	h.inFlight = false
	elapsed := time.Since(start).Milliseconds()
	writeJSON(w, http.StatusOK, updateResp{
		Updated:    true,
		Message:    "update completed",
		StartedAt:  start.UTC().Format(time.RFC3339),
		DurationMs: elapsed,
	})
}

func (h *RepopulateHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, http.StatusMethodNotAllowed, updateResp{
			Message: "method not allowed",
		})
		return
	}

	// Basic preflight checks
	if h == nil || h.Cfg == nil {
		writeJSON(w, http.StatusInternalServerError, updateResp{
			Message: "server misconfigured: nil AppConfig",
			Step:    "preflight",
		})
		return
	}
	if h.Pass == nil {
		writeJSON(w, http.StatusInternalServerError, updateResp{
			Message: "server misconfigured: nil PassConfig",
			Step:    "preflight",
		})
		return
	}

	// in-flight gate
	cool := h.Cooldown
	if cool <= 0 {
		cool = time.Minute
	}
	if h.inFlight {
		writeJSON(w, http.StatusTooManyRequests, updateResp{
			Message:    "update already in progress",
			InProgress: true,
			Step:       "gate",
		})
		return
	}

	// Reserve slot
	h.inFlight = true
	start := time.Now()

	// clear the inFlight flag and set lastRun on success
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("[/api/repopulate] panic: %v", rec)
			h.inFlight = false
		}
	}()

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()

	// DB update (incremental)
	if err := h.runDBRepopulate(ctx); err != nil {
		h.inFlight = false
		writeJSON(w, http.StatusInternalServerError, updateResp{
			Updated:   false,
			Message:   fmt.Sprintf("db-update failed: %v", err),
			StartedAt: start.UTC().Format(time.RFC3339),
			Step:      "db-update",
		})
		return
	}

	// Thumbnail generation
	if err := h.runThumbgen(ctx); err != nil {
		h.inFlight = false
		writeJSON(w, http.StatusInternalServerError, updateResp{
			Updated:   false,
			Message:   fmt.Sprintf("thumbgen failed: %v", err),
			StartedAt: start.UTC().Format(time.RFC3339),
			Step:      "thumbgen",
		})
		return
	}

	// Great Success
	h.lastRun = time.Now()
	h.inFlight = false
	elapsed := time.Since(start).Milliseconds()
	writeJSON(w, http.StatusOK, updateResp{
		Updated:    true,
		Message:    "update completed",
		StartedAt:  start.UTC().Format(time.RFC3339),
		DurationMs: elapsed,
	})
}

func (h *UpdateHandler) runDBUpdate(ctx context.Context) error {
	type result struct{ err error }
	ch := make(chan result, 1)
	go func() {
		err := com.RunDBUpdate(h.Cfg, h.Pass, false)
		ch <- result{err}
	}()
	select {
	case <-ctx.Done():
		return errors.New("db-update timed out or canceled")
	case res := <-ch:
		return res.err
	}
}

func (h *UpdateHandler) runThumbgen(ctx context.Context) error {
	dsn := filepath.Join(h.Cfg.Paths.DataDir, "image_metadata.db") + "?_busy_timeout=5000&_journal_mode=WAL&_cache_size=10000"
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("ping db: %w", err)
	}

	type result struct{ err error }
	ch := make(chan result, 1)
	go func() {
		err := com.RunThumbGen(h.Cfg, db)
		ch <- result{err}
	}()
	select {
	case <-ctx.Done():
		return errors.New("thumbgen timed out or canceled")
	case res := <-ch:
		return res.err
	}
}

func (h *RepopulateHandler) runThumbgen(ctx context.Context) error {
	dsn := filepath.Join(h.Cfg.Paths.DataDir, "image_metadata.db") + "?_busy_timeout=5000&_journal_mode=WAL&_cache_size=10000"
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("ping db: %w", err)
	}

	type result struct{ err error }
	ch := make(chan result, 1)
	go func() {
		err := com.RunThumbGen(h.Cfg, db)
		ch <- result{err}
	}()
	select {
	case <-ctx.Done():
		return errors.New("thumbgen timed out or canceled")
	case res := <-ch:
		return res.err
	}
}

func (h *RepopulateHandler) runDBRepopulate(ctx context.Context) error {
	type result struct{ err error }
	ch := make(chan result, 1)
	go func() {
		err := com.RunDBUpdate(h.Cfg, h.Pass, true)
		ch <- result{err}
	}()
	select {
	case <-ctx.Done():
		return errors.New("db-repopulate timed out or canceled")
	case res := <-ch:
		return res.err
	}
}

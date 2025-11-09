package handlers

import (
	"OnlySats/com"
	"OnlySats/com/shared"
	"encoding/json"
	"io/fs"
	"net/http"
	"path/filepath"
	"time"

	"github.com/gorilla/mux"
)

func ServeDiskStats(liveOutput string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if liveOutput == "" {
			http.Error(w, "live_output directory not configured", http.StatusInternalServerError)
			return
		}

		// Resolve to absolute (works for relative too)
		absRoot, err := filepath.Abs(liveOutput)
		if err != nil {
			http.Error(w, `{"error":"Unable to resolve live_output path"}`, http.StatusInternalServerError)
			return
		}

		total, free, err := diskTotalsForPath(absRoot) // implemented per-OS in files below
		if err != nil || total == 0 {
			http.Error(w, `{"error":"Unable to retrieve disk stats"}`, http.StatusInternalServerError)
			return
		}

		now := time.Now()
		cutoff := now.Add(-14 * 24 * time.Hour)

		fullSize := dirSize(absRoot, false, time.Time{})
		recentSize := dirSize(absRoot, true, cutoff)

		allocSize := fullSize + free

		retentionDays := 9999
		timeToFullDays := 9999
		if recentSize > 0 {
			retentionDays = int((float64(allocSize) / float64(recentSize)) * 14.0)
			timeToFullDays = int((float64(free) / float64(recentSize)) * 14.0)
			if retentionDays < 0 {
				retentionDays = 0
			}
			if timeToFullDays < 0 {
				timeToFullDays = 0
			}
		}

		resp := map[string]any{
			"disk": map[string]uint64{
				"total": total,
				"free":  free,
			},
			"live_output": map[string]uint64{
				"totalSize":  fullSize,
				"recentSize": recentSize,
			},
			"estimates": map[string]int{
				"dataRetentionDays":  retentionDays,
				"timeToDiskFullDays": timeToFullDays,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func dirSize(root string, recentOnly bool, cutoff time.Time) uint64 {
	var total uint64 = 0
	filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // skip unreadable
		}
		if d.IsDir() {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		if recentOnly && info.ModTime().Before(cutoff) {
			return nil
		}
		total += uint64(info.Size())
		return nil
	})
	return total
}

type UsersHandler struct {
	Store *com.LocalDataStore
}

type userRow struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Level    int    `json:"level"`
}

type createUserReq struct {
	Username string `json:"username"`
	Level    int    `json:"level"`
	Password string `json:"password"`
}

type createUserResp struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Level    int    `json:"level"`
}

type setUsernameReq struct {
	Username string `json:"username"`
}

type setLevelReq struct {
	Level int `json:"level"`
}

type resetPasswordReq struct {
	Generate    bool    `json:"generate"`
	NewPassword *string `json:"newPassword,omitempty"`
}

type resetPasswordResp struct {
	NewPassword string `json:"newPassword"`
}

func (h *UsersHandler) List(w http.ResponseWriter, r *http.Request) {
	users, err := h.Store.ListUsers(r.Context())
	if err != nil {
		http.Error(w, "failed to list users", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (h *UsersHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createUserReq
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Username == "" || req.Password == "" {
		http.Error(w, "username and password are required", http.StatusBadRequest)
		return
	}
	if req.Level < 0 || req.Level > 10 {
		http.Error(w, "level must be 0..10", http.StatusBadRequest)
		return
	}
	id, err := h.Store.CreateUser(r.Context(), req.Username, req.Level, req.Password)
	if err != nil {
		// unique constraint or other DB error
		http.Error(w, "create user failed", http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusCreated, createUserResp{
		ID:       id,
		Username: req.Username,
		Level:    req.Level,
	})
}

func (h *UsersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(mux.Vars(r), "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.Store.DeleteUser(r.Context(), id); err != nil {
		http.Error(w, "failed to delete user", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *UsersHandler) SetUsername(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(mux.Vars(r), "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var req setUsernameReq
	if json.NewDecoder(r.Body).Decode(&req) != nil || req.Username == "" {
		http.Error(w, "username required", http.StatusBadRequest)
		return
	}
	if err := h.Store.UpdateUsername(r.Context(), id, req.Username); err != nil {
		http.Error(w, "failed to update username (maybe not unique?)", http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *UsersHandler) SetLevel(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(mux.Vars(r), "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var req setLevelReq
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Level < 0 || req.Level > 10 {
		http.Error(w, "level must be 0..10", http.StatusBadRequest)
		return
	}
	if err := h.Store.UpdateUserLevel(r.Context(), id, req.Level); err != nil {
		http.Error(w, "failed to update level", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *UsersHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(mux.Vars(r), "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var req resetPasswordReq
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	var pw string
	if req.Generate {
		pw = shared.GenerateRandomPassword(12)
	} else if req.NewPassword != nil && *req.NewPassword != "" {
		pw = *req.NewPassword
	} else {
		http.Error(w, "either set generate=true or provide newPassword", http.StatusBadRequest)
		return
	}

	if err := h.Store.ResetUserPassword(r.Context(), id, pw); err != nil {
		http.Error(w, "failed to reset password", http.StatusInternalServerError)
		return
	}
	// Return the password once so the admin can deliver it out-of-band.
	writeJSON(w, http.StatusOK, resetPasswordResp{NewPassword: pw})
}

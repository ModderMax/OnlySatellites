package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"OnlySats/com/shared"
)

type APIHandler struct {
	DB *shared.Database
}

func NewAPIHandler(db *shared.Database) *APIHandler {
	return &APIHandler{DB: db}
}

type GalleryImage struct {
	ID          int     `json:"id"`
	Path        string  `json:"path"`
	Composite   string  `json:"composite"`
	Sensor      string  `json:"sensor"`
	MapOverlay  int     `json:"mapOverlay"`
	Corrected   int     `json:"corrected"`
	Filled      int     `json:"filled"`
	VPixels     *int    `json:"vPixels"`
	PassID      int     `json:"passId"`
	Timestamp   int64   `json:"timestamp"`
	Satellite   string  `json:"satellite"`
	Name        string  `json:"name"`
	RawDataPath *string `json:"rawDataPath"`
}

type ImageResponse struct {
	Images []GalleryImage `json:"images"`
	Total  int            `json:"total"`
	Page   int            `json:"page"`
	Limit  int            `json:"limit"`
}

type QueryFilters struct {
	MapOverlay    bool
	CorrectedOnly bool
	FilledOnly    bool

	Satellite string
	Band      string

	StartDate string
	EndDate   string
	StartTime string
	EndTime   string
	UseUTC    bool

	CompositeKeys []string

	Page      int
	Limit     int
	SortBy    string
	SortOrder string

	LimitType string
}

// HTTP

func (h *APIHandler) GetImages(w http.ResponseWriter, r *http.Request) {
	f := h.parseQueryFilters(r)

	whereSQL, args := h.buildWhere(f)

	var (
		images []GalleryImage
		total  int
		err    error
	)

	if f.LimitType == "passes" {
		images, total, err = h.queryByPasses(whereSQL, args, f)
	} else {
		images, total, err = h.queryByImages(whereSQL, args, f)
	}

	if err != nil {
		http.Error(w, fmt.Sprintf("Database error: %v", err), http.StatusInternalServerError)
		return
	}

	resp := ImageResponse{
		Images: images,
		Total:  total,
		Page:   f.Page,
		Limit:  f.Limit,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// Filters & WHERE

func (h *APIHandler) parseQueryFilters(r *http.Request) QueryFilters {
	q := r.URL.Query()

	mapOverlay := false
	if v := strings.ToLower(strings.TrimSpace(q.Get("mapsOnly"))); v == "1" || v == "true" {
		mapOverlay = true
	}
	correctedOnly := false
	if v := strings.ToLower(strings.TrimSpace(q.Get("correctedOnly"))); v == "1" || v == "true" {
		correctedOnly = true
	}
	filledOnly := false
	if v := strings.ToLower(strings.TrimSpace(q.Get("filledOnly"))); v == "1" || v == "true" {
		filledOnly = true
	}

	// composite filters (multi)
	compKeys := q["composite"]

	// base
	f := QueryFilters{
		MapOverlay:    mapOverlay,
		CorrectedOnly: correctedOnly,
		FilledOnly:    filledOnly,
		Satellite:     q.Get("satellite"),
		Band:          q.Get("band"),
		StartDate:     q.Get("startDate"),
		EndDate:       q.Get("endDate"),
		StartTime:     q.Get("startTime"),
		EndTime:       q.Get("endTime"),
		UseUTC:        q.Get("useUTC") != "0",

		Page:      1,
		Limit:     50,
		SortBy:    "timestamp",
		SortOrder: "DESC",
		LimitType: strings.ToLower(strings.TrimSpace(q.Get("limitType"))),
	}

	// pagination
	if v := strings.TrimSpace(q.Get("page")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			f.Page = n
		}
	}
	if v := strings.TrimSpace(q.Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			f.Limit = n
		}
	}
	if v := strings.TrimSpace(q.Get("sortBy")); v != "" {
		switch strings.ToLower(v) {
		case "vpixels", "images.vpixels":
			f.SortBy = "vPixels"
		default:
			f.SortBy = "timestamp"
		}
	}
	if v := strings.TrimSpace(q.Get("sortOrder")); v != "" {
		if strings.ToUpper(v) == "ASC" {
			f.SortOrder = "ASC"
		} else {
			f.SortOrder = "DESC"
		}
	}
	if f.LimitType != "passes" {
		f.LimitType = "images"
	}

	// composites
	for _, k := range compKeys {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		f.CompositeKeys = append(f.CompositeKeys, k)
	}

	return f
}

func (h *APIHandler) buildWhere(f QueryFilters) (string, []any) {
	var conditions []string
	var args []any

	// image-level filters
	if f.MapOverlay {
		conditions = append(conditions, "images.mapOverlay = 1")
	}
	if f.CorrectedOnly {
		conditions = append(conditions, "images.corrected = 1")
	}
	if f.FilledOnly {
		conditions = append(conditions, "images.filled = 1")
	}

	// composite filters — exact label match only (including "Other" as a normal label)
	if len(f.CompositeKeys) > 0 {
		// Normalize to lowercase and dedupe the requested labels
		selSet := make(map[string]struct{}, len(f.CompositeKeys))
		for _, s := range f.CompositeKeys {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			selSet[strings.ToLower(s)] = struct{}{}
		}

		if len(selSet) > 0 {
			// WHERE LOWER(images.composite) IN (?, ?, ...)
			placeholders := make([]string, 0, len(selSet))
			for range selSet {
				placeholders = append(placeholders, "?")
			}
			conditions = append(conditions, "LOWER(images.composite) IN ("+strings.Join(placeholders, ",")+")")
			for s := range selSet {
				args = append(args, s)
			}
		}
	}

	// pass-level filters
	if s := strings.TrimSpace(f.Satellite); s != "" {
		conditions = append(conditions, "passes.satellite = ?")
		args = append(args, s)
	}
	if b := strings.TrimSpace(f.Band); b != "" {
		conditions = append(conditions, "passes.downlink = ?")
		args = append(args, b)
	}

	// date range
	if f.StartDate != "" {
		start := h.parseDateTime(f.StartDate, "00:00", f.UseUTC)
		conditions = append(conditions, "passes.timestamp >= ?")
		args = append(args, start)
	}
	if f.EndDate != "" {
		end := h.parseDateTime(f.EndDate, "23:59", f.UseUTC)
		conditions = append(conditions, "passes.timestamp <= ?")
		args = append(args, end)
	}

	// time-of-day window (seconds modulo 86400)
	if f.StartTime != "" {
		startSeconds := h.parseTimeString(f.StartTime, f.UseUTC)
		conditions = append(conditions, "(passes.timestamp % 86400) >= ?")
		args = append(args, startSeconds)
	}
	if f.EndTime != "" {
		endSeconds := h.parseTimeString(f.EndTime, f.UseUTC)
		conditions = append(conditions, "(passes.timestamp % 86400) <= ?")
		args = append(args, endSeconds)
	}

	if len(conditions) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(conditions, " AND "), args
}

// Queries

func (h *APIHandler) queryByImages(whereSQL string, args []any, f QueryFilters) ([]GalleryImage, int, error) {
	sortCol := "passes.timestamp"
	if f.SortBy == "vPixels" {
		sortCol = "images.vPixels"
	}
	sortDir := f.SortOrder

	limit := clamp(f.Limit, 1, 500)
	offset := 0
	if f.Page > 1 {
		offset = (f.Page - 1) * limit
	}

	// Count
	countSQL := `
		SELECT COUNT(*)
		FROM images
		JOIN passes ON images.passId = passes.id
	` + " " + whereSQL
	var total int
	if err := h.DB.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Data
	selectSQL := `
		SELECT
			images.id, images.path, images.composite, images.sensor,
			images.mapOverlay, images.corrected, images.filled,
			images.vPixels, images.passId,
			passes.timestamp, COALESCE(passes.satellite,'Unknown'), passes.name, passes.rawDataPath
		FROM images
		JOIN passes ON images.passId = passes.id
	` + " " + whereSQL + `
		ORDER BY ` + sortCol + " " + sortDir + `
		LIMIT ? OFFSET ?
	`

	argsWithPaging := append(append([]any{}, args...), limit, offset)
	rows, err := h.DB.Query(selectSQL, argsWithPaging...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]GalleryImage, 0, limit)
	for rows.Next() {
		var gi GalleryImage
		if err := rows.Scan(
			&gi.ID, &gi.Path, &gi.Composite, &gi.Sensor,
			&gi.MapOverlay, &gi.Corrected, &gi.Filled,
			&gi.VPixels, &gi.PassID,
			&gi.Timestamp, &gi.Satellite, &gi.Name, &gi.RawDataPath,
		); err != nil {
			return nil, 0, err
		}
		gi.Path = strings.ReplaceAll(gi.Path, `\`, `/`)
		out = append(out, gi)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return out, total, nil
}

// Pass-limited: pick pass set from *filtered images*, then return only those filtered images.
func (h *APIHandler) queryByPasses(whereSQL string, args []any, f QueryFilters) ([]GalleryImage, int, error) {
	limit := clamp(f.Limit, 1, 200)

	// rewrite WHERE for CTE aliases i/p
	whereForCTE := strings.ReplaceAll(whereSQL, "images.", "i.")
	whereForCTE = strings.ReplaceAll(whereForCTE, "passes.", "p.")

	var sql string
	if f.SortBy == "vPixels" {
		sql = `
			WITH filtered AS (
				SELECT
					i.*,
					p.timestamp    AS p_timestamp,
					p.satellite    AS p_satellite,
					p.name         AS p_name,
					p.rawDataPath  AS p_rawDataPath
				FROM images i
				JOIN passes p ON i.passId = p.id
				` + " " + whereForCTE + `
			),
			pass_metrics AS (
				SELECT passId, MAX(vPixels) AS maxVPixels
				FROM filtered
				GROUP BY passId
			),
			selected_passes AS (
				SELECT pm.passId AS id
				FROM pass_metrics pm
				JOIN passes p ON p.id = pm.passId
				ORDER BY pm.maxVPixels ` + f.SortOrder + `, p.timestamp DESC
				LIMIT ?
			)
			SELECT
				f.id, f.path, f.composite, f.sensor,
				f.mapOverlay, f.corrected, f.filled,
				f.vPixels, f.passId,
				f.p_timestamp, COALESCE(f.p_satellite,'Unknown'), f.p_name, f.p_rawDataPath
			FROM filtered f
			JOIN selected_passes sp ON f.passId = sp.id
			ORDER BY f.p_timestamp DESC, f.id ASC
		`
	} else {
		sql = `
			WITH filtered AS (
				SELECT
					i.*,
					p.timestamp    AS p_timestamp,
					p.satellite    AS p_satellite,
					p.name         AS p_name,
					p.rawDataPath  AS p_rawDataPath
				FROM images i
				JOIN passes p ON i.passId = p.id
				` + " " + whereForCTE + `
			),
			selected_passes AS (
				SELECT passId AS id, MAX(p_timestamp) AS max_ts
				FROM filtered
				GROUP BY passId
				ORDER BY max_ts ` + f.SortOrder + `
				LIMIT ?
			)
			SELECT
				f.id, f.path, f.composite, f.sensor,
				f.mapOverlay, f.corrected, f.filled,
				f.vPixels, f.passId,
				f.p_timestamp, COALESCE(f.p_satellite,'Unknown'), f.p_name, f.p_rawDataPath
			FROM filtered f
			JOIN selected_passes sp ON f.passId = sp.id
			ORDER BY f.p_timestamp ` + f.SortOrder + `, f.id ASC
		`
	}

	argsFinal := append(append([]any{}, args...), limit)

	rows, err := h.DB.Query(sql, argsFinal...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []GalleryImage
	for rows.Next() {
		var gi GalleryImage
		if err := rows.Scan(
			&gi.ID, &gi.Path, &gi.Composite, &gi.Sensor,
			&gi.MapOverlay, &gi.Corrected, &gi.Filled,
			&gi.VPixels, &gi.PassID,
			&gi.Timestamp, &gi.Satellite, &gi.Name, &gi.RawDataPath,
		); err != nil {
			return nil, 0, err
		}
		gi.Path = strings.ReplaceAll(gi.Path, `\`, `/`)
		out = append(out, gi)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, len(out), nil
}

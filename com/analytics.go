package com

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"time"
)

type TrackPoint struct {
	Az  float64 `json:"az"`
	El  float64 `json:"el"`
	SNR float64 `json:"snr"`
}

type satdumpLogEntry struct {
	ts       int64
	instance string
	data     []byte
}

// warn: recursive
func trimJSON(v any, decimals int) any {
	switch t := v.(type) {
	case float64:
		if math.IsNaN(t) || math.IsInf(t, 0) {
			return t
		}
		mul := math.Pow(10, float64(decimals))
		return math.Round(t*mul) / mul
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, vv := range t {
			out[k] = trimJSON(vv, decimals)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, vv := range t {
			out[i] = trimJSON(vv, decimals)
		}
		return out
	default:
		return v
	}
}

func selectSatdumpPayload(raw any) (map[string]any, bool) {
	root, ok := raw.(map[string]any)
	if !ok {
		return nil, false
	}

	if lp, ok := root["live_pipeline"].(map[string]any); ok {
		out := make(map[string]any, 3)

		out["live_pipeline"] = lp

		if ot, ok := root["object_tracker"].(map[string]any); ok {
			sub := make(map[string]any)

			if scp, ok := ot["sat_current_pos"]; ok {
				sub["sat_current_pos"] = scp
			}
			if name, ok := ot["object_name"]; ok {
				sub["object_name"] = name
			}

			if len(sub) > 0 {
				out["object_tracker"] = sub
			}
		}

		return out, true
	}

	if psk, ok := root["psk_demod"].(map[string]any); ok {
		out := make(map[string]any)
		out["psk_demod"] = psk

		if ccsds, ok := root["ccsds_conv_concat_decoder"]; ok {
			out["ccsds_conv_concat_decoder"] = ccsds
		} else if gvar, ok := root["goes_gvar_image_decoder"]; ok {
			out["goes_gvar_image_decoder"] = gvar
		}

		return out, true
	}

	return nil, false
}

func queueSatdump(ctx context.Context, out chan<- satdumpLogEntry, instance string, raw any) error {
	filtered, ok := selectSatdumpPayload(raw)
	if !ok {
		return nil
	}

	rounded := trimJSON(filtered, 2)

	b, err := json.Marshal(rounded)
	if err != nil {
		return err
	}

	entry := satdumpLogEntry{
		ts:       time.Now().UTC().Unix(),
		instance: instance,
		data:     b,
	}

	select {
	case out <- entry:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func fetchAndEnqueueSatdump(ctx context.Context, out chan<- satdumpLogEntry, instance, endpoint string) error {
	raw, err := httpGetJSON(ctx, endpoint)
	if err != nil {
		return err
	}
	return queueSatdump(ctx, out, instance, raw)
}

func GetSatdumpActive(ctx context.Context, db *sql.DB) []string {
	rows, err := db.QueryContext(ctx, `
		WITH t AS (
		  SELECT json_extract(data, '$.object_tracker.object_name') AS name
		  FROM satdump_readings
		)
		SELECT DISTINCT name FROM t
		WHERE name IS NOT NULL AND name <> ''
		ORDER BY name;
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			out = append(out, name)
		}
	}
	return out
}

func TracksSNR(ctx context.Context, db *sql.DB, objectName string, from, to int64) ([]TrackPoint, error) {
	const q = `
SELECT
  CAST(json_extract(data, '$.object_tracker.sat_current_pos.az') AS REAL)  AS az,
  CAST(json_extract(data, '$.object_tracker.sat_current_pos.el') AS REAL)  AS el,
  CAST(json_extract(data, '$.live_pipeline.psk_demod.snr')       AS REAL)  AS snr
FROM satdump_readings
WHERE ts BETWEEN ? AND ?
  AND json_extract(data, '$.object_tracker.object_name') = ?
ORDER BY ts;
`
	rows, err := db.QueryContext(ctx, q, from, to, objectName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TrackPoint, 0, 1024)
	for rows.Next() {
		var az, el, snr sql.NullFloat64
		if err := rows.Scan(&az, &el, &snr); err != nil {
			return nil, err
		}
		if az.Valid && el.Valid && snr.Valid {
			out = append(out, TrackPoint{
				Az:  az.Float64,
				El:  el.Float64,
				SNR: snr.Float64,
			})
		}
	}
	return out, rows.Err()
}

type DecoderPoint struct {
	Pct             int     `json:"pct"`
	AvgSNR          float64 `json:"avg_snr"`
	Low1PctSNR      float64 `json:"low1pct_snr"`
	High1PctSNR     float64 `json:"high1pct_snr"`
	AvgBER          float64 `json:"avg_ber"`
	MinBER          float64 `json:"min_ber"`
	MaxBER          float64 `json:"max_ber"`
	ProgressRounded string  `json:"progress_rounded"`
}

func DecoderSNRStats(ctx context.Context, db *sql.DB, decoder string, from, to int64) ([]DecoderPoint, error) {
	if decoder == "" {
		return nil, fmt.Errorf("decoder is required")
	}
	pathSNR := "$.psk_demod.snr"
	pathBER := fmt.Sprintf("$.%s.viterbi_ber", decoder)

	q := fmt.Sprintf(`
SELECT
  ts,
  CAST(json_extract(data, '%s') AS REAL) AS snr,
  CAST(json_extract(data, '%s') AS REAL) AS ber
FROM satdump_readings
WHERE ts BETWEEN ? AND ?
  AND json_extract(data, '$.%s') IS NOT NULL
ORDER BY ts;
`, pathSNR, pathBER, decoder)

	rows, err := db.QueryContext(ctx, q, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type row struct {
		snr    float64
		hasBER bool
		ber    float64
	}

	var all []row
	for rows.Next() {
		var tsVal int64
		var sn, ber sql.NullFloat64
		if err := rows.Scan(&tsVal, &sn, &ber); err != nil {
			return nil, err
		}
		if !sn.Valid {
			continue
		}
		r := row{snr: sn.Float64}
		if ber.Valid {
			r.hasBER = true
			r.ber = ber.Float64
		}
		all = append(all, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(all) == 0 {
		return []DecoderPoint{}, nil
	}

	type bucket struct {
		snrs    []float64
		sumProg float64

		sumBER float64
		minBER float64
		maxBER float64
		cntBER int
	}
	var buckets [101]bucket

	n := len(all)
	den := float64(n - 1)
	if den <= 0 {
		den = 1
	}

	for i, r := range all {
		p := float64(i) * 100.0 / den
		if p < 0 {
			p = 0
		}
		if p > 100 {
			p = 100
		}
		idx := int(p)
		if idx < 0 || idx > 100 {
			continue
		}
		b := &buckets[idx]
		b.snrs = append(b.snrs, r.snr)
		b.sumProg += p

		if r.hasBER {
			if b.cntBER == 0 {
				b.minBER = r.ber
				b.maxBER = r.ber
			} else {
				if r.ber < b.minBER {
					b.minBER = r.ber
				}
				if r.ber > b.maxBER {
					b.maxBER = r.ber
				}
			}
			b.sumBER += r.ber
			b.cntBER++
		}
	}

	out := make([]DecoderPoint, 0, 101)
	for i := 0; i <= 100; i++ {
		b := buckets[i]
		if len(b.snrs) == 0 {
			continue
		}
		var sumSNR float64
		for _, v := range b.snrs {
			sumSNR += v
		}

		avgSNR := sumSNR / float64(len(b.snrs))
		sort.Float64s(b.snrs)
		n := len(b.snrs)
		lowIdx := int(math.Floor(0.01 * float64(n)))
		highIdx := int(math.Floor(0.99 * float64(n)))
		if lowIdx < 0 {
			lowIdx = 0
		}
		if lowIdx >= n {
			lowIdx = n - 1
		}
		if highIdx < 0 {
			highIdx = 0
		}
		if highIdx >= n {
			highIdx = n - 1
		}

		dp := DecoderPoint{
			Pct:         i,
			AvgSNR:      math.Round(avgSNR*100) / 100,
			Low1PctSNR:  b.snrs[lowIdx],
			High1PctSNR: b.snrs[highIdx],
			AvgBER:      math.NaN(),
			MinBER:      math.NaN(),
			MaxBER:      math.NaN(),
		}

		if b.cntBER > 0 {
			dp.AvgBER = b.sumBER / float64(b.cntBER)
			dp.MinBER = b.minBER
			dp.MaxBER = b.maxBER
		}
		out = append(out, dp)
	}
	return out, nil
}

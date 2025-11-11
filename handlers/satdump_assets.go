package handlers

import (
	"io"
	"log"
	"net/http"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var allowedExt = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
	".webp": true, ".svg": true,
}

// simple path sanity check: allow word chars, dashes, underscores, slashes, dots
var safePathRe = regexp.MustCompile(`^[\w\-/\.]+$`)

// SatdumpAssetProxy forwards /local/<asset> to http://hostIP:port/<asset>
func SatdumpAssetProxy(hostIP string, port int) http.HandlerFunc {
	client := &http.Client{Timeout: 5 * time.Second}

	base := "http://" + hostIP + ":" + itoa(port)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Expected incoming path: /local/<asset>
		p := strings.TrimPrefix(r.URL.Path, "/local/")
		p = path.Clean("/" + p) // ensure leading slash for target

		// Validate path + extension
		if !safePathRe.MatchString(p) {
			http.Error(w, "bad asset path", http.StatusBadRequest)
			return
		}
		if !allowedExt[strings.ToLower(filepath.Ext(p))] {
			http.NotFound(w, r)
			return
		}

		// Build target URL (preserve query)
		target := base + p
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
		if err != nil {
			http.Error(w, "proxy build failed", http.StatusInternalServerError)
			return
		}
		// propagate basic headers
		req.Header.Set("User-Agent", r.UserAgent())

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("satdump asset proxy error: %v", err)
			http.Error(w, "upstream error", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		// pass through status + content-type + cache headers
		for k, vv := range resp.Header {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	})
}

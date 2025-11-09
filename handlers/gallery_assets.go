package handlers

import (
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// serves original images from liveOutputDir.
// Request: /images/<images.path from DB>
func ImageServer(liveOutputDir string) http.HandlerFunc {
	rootAbs, err := filepath.Abs(liveOutputDir)
	if err != nil {
		log.Printf("[images] warning: Abs() failed for %q: %v", liveOutputDir, err)
		rootAbs = liveOutputDir
	}

	return func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(r.URL.Path, "/images/")
		if rel == "" {
			http.NotFound(w, r)
			return
		}
		full, err := safeJoin(rootAbs, rel)
		if err != nil {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}

		f, err := os.Open(full)
		if err != nil {
			if os.IsNotExist(err) {
				http.NotFound(w, r)
				return
			}
			log.Printf("[images] failed to open %q: %v", full, err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		defer f.Close()

		info, err := f.Stat()
		if err != nil {
			log.Printf("[images] stat failed for %q: %v", full, err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if info.IsDir() {
			http.NotFound(w, r)
			return
		}

		if ct := mime.TypeByExtension(strings.ToLower(filepath.Ext(info.Name()))); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		setCacheHeaders(w)
		http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	}
}

// If thumbRoot != "", mirror under that root, else beside originals in <pass/subdir>/thumbnails/<name>.webp
func ThumbnailServer(liveOutputDir, thumbRoot string) http.HandlerFunc {
	liveAbs, err := filepath.Abs(liveOutputDir)
	if err != nil {
		log.Printf("[thumbs] warning: Abs() failed for live_output %q: %v", liveOutputDir, err)
		liveAbs = liveOutputDir
	}

	useCentral := strings.TrimSpace(thumbRoot) != ""
	var centralAbs string
	if useCentral {
		if ca, err := filepath.Abs(thumbRoot); err == nil {
			centralAbs = ca
		} else {
			log.Printf("[thumbs] warning: Abs() failed for thumbRoot %q: %v", thumbRoot, err)
			centralAbs = thumbRoot
		}
	}

	return func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(r.URL.Path, "/thumbnails/")
		if rel == "" {
			http.NotFound(w, r)
			return
		}

		var target string
		var err error

		if useCentral {
			// mirror rel under central root, but swap extension to .webp
			dir := filepath.Dir(rel)
			name := strings.TrimSuffix(filepath.Base(rel), filepath.Ext(rel)) + ".webp"
			target, err = safeJoin(centralAbs, filepath.Join(dir, name))
			if err != nil {
				http.Error(w, "bad path", http.StatusBadRequest)
				return
			}
		} else {
			// side-by-side: <live>/<dir>/thumbnails/<name>.webp
			dir := filepath.Dir(rel)
			name := strings.TrimSuffix(filepath.Base(rel), filepath.Ext(rel)) + ".webp"
			target, err = safeJoin(liveAbs, filepath.Join(dir, "thumbnails", name))
			if err != nil {
				http.Error(w, "bad path", http.StatusBadRequest)
				return
			}
		}

		f, err := os.Open(target)
		if err != nil {
			if os.IsNotExist(err) {
				http.NotFound(w, r)
				return
			}
			log.Printf("[thumbs] failed to open %q: %v", target, err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		defer f.Close()

		info, err := f.Stat()
		if err != nil {
			log.Printf("[thumbs] stat failed for %q: %v", target, err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if info.IsDir() {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Content-Type", "image/webp")
		setCacheHeaders(w)
		http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	}
}

func setCacheHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "public, max-age=300, immutable")
	w.Header().Set("Expires", time.Now().Add(7*24*time.Hour).UTC().Format(http.TimeFormat))
}

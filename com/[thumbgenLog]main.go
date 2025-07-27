package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/h2non/bimg"
	_ "github.com/mattn/go-sqlite3"
)

const (
	dbPath         = "./data/image_metadata.db"
	outputDir      = "./live_output"
	thumbnailWidth = 200
	maxWorkers     = 8
	batchSize      = 1000
)

type ImagePath struct {
	Path string
}

// Performance metrics
type PerformanceMetrics struct {
	TotalImages     int64
	SkippedImages   int64
	ProcessedImages int64
	FailedImages    int64

	// Timing metrics (in nanoseconds for atomic operations)
	TotalDBTime           int64
	TotalFileIOTime       int64
	TotalImageDecodeTime  int64
	TotalImageProcessTime int64
	TotalImageWriteTime   int64
	TotalFileSystemTime   int64

	// Size metrics
	TotalBytesRead    int64
	TotalBytesWritten int64

	mu              sync.RWMutex
	DetailedTimings map[string][]time.Duration
}

func NewPerformanceMetrics() *PerformanceMetrics {
	return &PerformanceMetrics{
		DetailedTimings: make(map[string][]time.Duration),
	}
}

func (pm *PerformanceMetrics) AddTiming(category string, duration time.Duration) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.DetailedTimings[category] = append(pm.DetailedTimings[category], duration)
}

func (pm *PerformanceMetrics) PrintReport(logger *log.Logger) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	logger.Println("\n=== PERFORMANCE REPORT ===")
	logger.Printf("Total Images: %d\n", pm.TotalImages)
	logger.Printf("Processed: %d, Skipped: %d, Failed: %d\n",
		pm.ProcessedImages, pm.SkippedImages, pm.FailedImages)

	// Convert nanoseconds to milliseconds for readability
	logger.Printf("\nTiming Breakdown (total):\n")
	logger.Printf("  Database queries: %.2fms\n", float64(pm.TotalDBTime)/1e6)
	logger.Printf("  File I/O (read): %.2fms\n", float64(pm.TotalFileIOTime)/1e6)
	logger.Printf("  Image decoding: %.2fms\n", float64(pm.TotalImageDecodeTime)/1e6)
	logger.Printf("  Image processing: %.2fms\n", float64(pm.TotalImageProcessTime)/1e6)
	logger.Printf("  Image writing: %.2fms\n", float64(pm.TotalImageWriteTime)/1e6)
	logger.Printf("  File system ops: %.2fms\n", float64(pm.TotalFileSystemTime)/1e6)

	logger.Printf("\nData Transfer:\n")
	logger.Printf("  Bytes read: %.2f MB\n", float64(pm.TotalBytesRead)/1e6)
	logger.Printf("  Bytes written: %.2f MB\n", float64(pm.TotalBytesWritten)/1e6)

	// Average timings per operation
	if pm.ProcessedImages > 0 {
		logger.Printf("\nAverage per processed image:\n")
		logger.Printf("  File I/O: %.2fms\n", float64(pm.TotalFileIOTime)/1e6/float64(pm.ProcessedImages))
		logger.Printf("  Decoding: %.2fms\n", float64(pm.TotalImageDecodeTime)/1e6/float64(pm.ProcessedImages))
		logger.Printf("  Processing: %.2fms\n", float64(pm.TotalImageProcessTime)/1e6/float64(pm.ProcessedImages))
		logger.Printf("  Writing: %.2fms\n", float64(pm.TotalImageWriteTime)/1e6/float64(pm.ProcessedImages))
	}

	// Detailed timing percentiles
	logger.Printf("\nDetailed Timing Analysis:\n")
	for category, timings := range pm.DetailedTimings {
		if len(timings) > 0 {
			logger.Printf("  %s (%d operations):\n", category, len(timings))

			// Sort timings
			sorted := make([]time.Duration, len(timings))
			copy(sorted, timings)
			for i := 0; i < len(sorted); i++ {
				for j := i + 1; j < len(sorted); j++ {
					if sorted[i] > sorted[j] {
						sorted[i], sorted[j] = sorted[j], sorted[i]
					}
				}
			}

			// Calculate percentiles
			p50 := sorted[len(sorted)/2]
			p90 := sorted[int(float64(len(sorted))*0.9)]
			p99 := sorted[int(float64(len(sorted))*0.99)]

			logger.Printf("    P50: %.2fms, P90: %.2fms, P99: %.2fms\n",
				float64(p50)/1e6, float64(p90)/1e6, float64(p99)/1e6)
		}
	}
}

var globalMetrics = NewPerformanceMetrics()

func main() {
	// Set GOMAXPROCS to use all available CPU cores
	runtime.GOMAXPROCS(runtime.NumCPU())

	startTime := time.Now()

	// Create log file with datetime
	logFileName := fmt.Sprintf("Backups\\log_%s.txt", startTime.Format("2006-01-02_15-04-05"))
	logFile, err := os.Create(logFileName)
	if err != nil {
		log.Fatalf("Failed to create log file: %v", err)
	}
	defer logFile.Close()

	// Create logger that writes to both file and stdout
	multiWriter := io.MultiWriter(logFile, os.Stdout)
	logger := log.New(multiWriter, "", log.LstdFlags)

	logger.Printf("Starting image processing - Log file: %s\n", logFileName)

	// Open SQLite database with optimized settings
	dbStart := time.Now()
	db, err := sql.Open("sqlite3", dbPath+"?cache=shared&mode=ro")
	if err != nil {
		logger.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// Optimize database connection
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	// Test database connection
	if err := db.Ping(); err != nil {
		logger.Fatalf("Failed to connect to database: %v", err)
	}

	atomic.AddInt64(&globalMetrics.TotalDBTime, int64(time.Since(dbStart)))

	// Get total count first for progress tracking
	countStart := time.Now()
	totalCount, err := getImageCount(db)
	if err != nil {
		logger.Fatalf("Failed to get image count: %v", err)
	}
	atomic.AddInt64(&globalMetrics.TotalDBTime, int64(time.Since(countStart)))
	atomic.AddInt64(&globalMetrics.TotalImages, int64(totalCount))

	logger.Printf("Found %d images to process\n", totalCount)

	// Process images in batches
	totalProcessed := 0

	for offset := 0; offset < totalCount; offset += batchSize {
		batchStart := time.Now()

		// Query batch of images
		queryStart := time.Now()
		images, err := getImagePathsBatch(db, offset, batchSize)
		if err != nil {
			logger.Fatalf("Failed to get image paths batch: %v", err)
		}
		queryDuration := time.Since(queryStart)
		atomic.AddInt64(&globalMetrics.TotalDBTime, int64(queryDuration))
		globalMetrics.AddTiming("db_batch_query", queryDuration)

		if len(images) == 0 {
			break
		}

		logger.Printf("Processing batch %d-%d of %d images\n", offset+1, offset+len(images), totalCount)

		// Process batch concurrently
		processed := processImagesConcurrently(images, logger)
		totalProcessed += processed

		batchDuration := time.Since(batchStart)
		logger.Printf("Batch completed in %.2fs (%.2f images/second)\n",
			batchDuration.Seconds(), float64(len(images))/batchDuration.Seconds())

		// Force garbage collection between batches
		gcStart := time.Now()
		runtime.GC()
		gcDuration := time.Since(gcStart)
		globalMetrics.AddTiming("garbage_collection", gcDuration)
	}

	elapsed := time.Since(startTime)
	logger.Printf("\nCompleted! Processed %d images in %v (%.2f images/second)\n",
		totalProcessed, elapsed, float64(totalProcessed)/elapsed.Seconds())

	// Print detailed performance report
	globalMetrics.PrintReport(logger)

	// Memory statistics
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	logger.Printf("\nMemory Statistics:\n")
	logger.Printf("  Allocated: %.2f MB\n", float64(m.Alloc)/1e6)
	logger.Printf("  Total Allocated: %.2f MB\n", float64(m.TotalAlloc)/1e6)
	logger.Printf("  System Memory: %.2f MB\n", float64(m.Sys)/1e6)
	logger.Printf("  GC Cycles: %d\n", m.NumGC)

	logger.Printf("\nLog written to: %s\n", logFileName)
}

func getImageCount(db *sql.DB) (int, error) {
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM images").Scan(&count)
	return count, err
}

func getImagePathsBatch(db *sql.DB, offset, limit int) ([]ImagePath, error) {
	query := "SELECT path FROM images LIMIT ? OFFSET ?"
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query images: %w", err)
	}
	defer rows.Close()

	var images []ImagePath
	for rows.Next() {
		var img ImagePath
		if err := rows.Scan(&img.Path); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		images = append(images, img)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	return images, nil
}

func processImagesConcurrently(images []ImagePath, logger *log.Logger) int {
	jobs := make(chan ImagePath, len(images))
	results := make(chan ProcessResult, len(images))

	// Start workers
	var wg sync.WaitGroup
	for i := 0; i < maxWorkers; i++ {
		wg.Add(1)
		go worker(jobs, results, &wg)
	}

	// Send jobs
	for _, img := range images {
		jobs <- img
	}
	close(jobs)

	// Collect results
	go func() {
		wg.Wait()
		close(results)
	}()

	// Count results
	processed := 0
	successful := 0
	for result := range results {
		processed++
		if result.Success {
			successful++
		}
		// Only print errors or every 100th success
		if !result.Success || processed%100 == 0 {
			logger.Printf("[%d/%d] %s\n", processed, len(images), result.Message)
		}
	}

	return successful
}

type ProcessResult struct {
	Success bool
	Message string
}

func worker(jobs <-chan ImagePath, results chan<- ProcessResult, wg *sync.WaitGroup) {
	defer wg.Done()

	for img := range jobs {
		if err := processImage(img.Path); err != nil {
			atomic.AddInt64(&globalMetrics.FailedImages, 1)
			results <- ProcessResult{
				Success: false,
				Message: fmt.Sprintf("Error processing %s: %v", img.Path, err),
			}
		} else {
			results <- ProcessResult{
				Success: true,
				Message: fmt.Sprintf("Successfully processed %s", img.Path),
			}
		}
	}
}

func processImage(imagePath string) error {
	totalStart := time.Now()

	// Build full paths
	fullImagePath := filepath.Join(outputDir, imagePath)
	imageDir := filepath.Dir(fullImagePath)
	filename := filepath.Base(imagePath)
	filenameWithoutExt := strings.TrimSuffix(filename, filepath.Ext(filename))

	// Create thumbnails directory path
	thumbnailDir := filepath.Join(imageDir, "thumbnails")
	thumbnailPath := filepath.Join(thumbnailDir, filenameWithoutExt+".webp")

	// Check if thumbnail already exists
	fsStart := time.Now()
	if _, err := os.Stat(thumbnailPath); err == nil {
		atomic.AddInt64(&globalMetrics.SkippedImages, 1)
		fsDuration := time.Since(fsStart)
		atomic.AddInt64(&globalMetrics.TotalFileSystemTime, int64(fsDuration))
		globalMetrics.AddTiming("file_stat_skip", fsDuration)
		return nil
	}

	// Check if source image exists
	if _, err := os.Stat(fullImagePath); os.IsNotExist(err) {
		fsDuration := time.Since(fsStart)
		atomic.AddInt64(&globalMetrics.TotalFileSystemTime, int64(fsDuration))
		return fmt.Errorf("source image does not exist: %s", fullImagePath)
	}

	// Create thumbnails directory if it doesn't exist
	if err := os.MkdirAll(thumbnailDir, 0755); err != nil {
		fsDuration := time.Since(fsStart)
		atomic.AddInt64(&globalMetrics.TotalFileSystemTime, int64(fsDuration))
		return fmt.Errorf("failed to create thumbnails directory: %w", err)
	}

	fsDuration := time.Since(fsStart)
	atomic.AddInt64(&globalMetrics.TotalFileSystemTime, int64(fsDuration))
	globalMetrics.AddTiming("filesystem_setup", fsDuration)

	// Read source image
	readStart := time.Now()
	imageData, err := bimg.Read(fullImagePath)
	if err != nil {
		return fmt.Errorf("failed to read image: %w", err)
	}
	readDuration := time.Since(readStart)
	atomic.AddInt64(&globalMetrics.TotalFileIOTime, int64(readDuration))
	atomic.AddInt64(&globalMetrics.TotalBytesRead, int64(len(imageData)))
	globalMetrics.AddTiming("image_read", readDuration)

	// Decode and get image size
	decodeStart := time.Now()
	image := bimg.NewImage(imageData)
	size, err := image.Size()
	if err != nil {
		return fmt.Errorf("failed to get image size: %w", err)
	}
	decodeDuration := time.Since(decodeStart)
	atomic.AddInt64(&globalMetrics.TotalImageDecodeTime, int64(decodeDuration))
	globalMetrics.AddTiming("image_decode", decodeDuration)

	// Calculate new height maintaining aspect ratio
	aspectRatio := float64(size.Height) / float64(size.Width)
	newHeight := int(float64(thumbnailWidth) * aspectRatio)

	// Process image
	processStart := time.Now()
	options := bimg.Options{
		Width:         thumbnailWidth,
		Height:        newHeight,
		Type:          bimg.WEBP,
		Quality:       75,
		StripMetadata: true,
		NoAutoRotate:  false,
		Lossless:      false,
		Compression:   6,
		Interlace:     true,
	}

	thumbnailData, err := image.Process(options)
	if err != nil {
		return fmt.Errorf("failed to process image: %w", err)
	}
	processDuration := time.Since(processStart)
	atomic.AddInt64(&globalMetrics.TotalImageProcessTime, int64(processDuration))
	globalMetrics.AddTiming("image_process", processDuration)

	// Write thumbnail to file
	writeStart := time.Now()
	if err := bimg.Write(thumbnailPath, thumbnailData); err != nil {
		return fmt.Errorf("failed to write thumbnail: %w", err)
	}
	writeDuration := time.Since(writeStart)
	atomic.AddInt64(&globalMetrics.TotalImageWriteTime, int64(writeDuration))
	atomic.AddInt64(&globalMetrics.TotalBytesWritten, int64(len(thumbnailData)))
	globalMetrics.AddTiming("image_write", writeDuration)

	// Record successful processing
	atomic.AddInt64(&globalMetrics.ProcessedImages, 1)

	totalDuration := time.Since(totalStart)
	globalMetrics.AddTiming("total_per_image", totalDuration)

	return nil
}

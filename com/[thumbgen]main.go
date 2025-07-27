package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
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

func main() {
	// Set GOMAXPROCS to use all available CPU cores
	runtime.GOMAXPROCS(runtime.NumCPU())

	startTime := time.Now()

	// Open SQLite database with optimized settings
	db, err := sql.Open("sqlite3", dbPath+"?cache=shared&mode=ro")
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// Optimize database connection
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	// Test database connection
	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// Get total count first for progress tracking
	totalCount, err := getImageCount(db)
	if err != nil {
		log.Fatalf("Failed to get image count: %v", err)
	}

	fmt.Printf("Found %d images to process\n", totalCount)

	// Process images in batches
	totalProcessed := 0

	for offset := 0; offset < totalCount; offset += batchSize {
		// Query batch of images
		images, err := getImagePathsBatch(db, offset, batchSize)
		if err != nil {
			log.Fatalf("Failed to get image paths batch: %v", err)
		}

		if len(images) == 0 {
			break
		}

		// Process batch concurrently
		processed := processImagesConcurrently(images)
		totalProcessed += processed

		// Force garbage collection between batches
		runtime.GC()
	}

	elapsed := time.Since(startTime)
	fmt.Printf("Completed! Processed %d images in %v\n", totalProcessed, elapsed)
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

func processImagesConcurrently(images []ImagePath) int {
	jobs := make(chan ImagePath, len(images))
	results := make(chan bool, len(images))

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

	// Count successful results
	successful := 0
	for success := range results {
		if success {
			successful++
		}
	}

	return successful
}

func worker(jobs <-chan ImagePath, results chan<- bool, wg *sync.WaitGroup) {
	defer wg.Done()

	for img := range jobs {
		success := processImage(img.Path) == nil
		results <- success
	}
}

func processImage(imagePath string) error {
	// Build full paths
	fullImagePath := filepath.Join(outputDir, imagePath)
	imageDir := filepath.Dir(fullImagePath)
	filename := filepath.Base(imagePath)
	filenameWithoutExt := strings.TrimSuffix(filename, filepath.Ext(filename))

	// Create thumbnails directory path
	thumbnailDir := filepath.Join(imageDir, "thumbnails")
	thumbnailPath := filepath.Join(thumbnailDir, filenameWithoutExt+".webp")

	// Check if thumbnail already exists
	if _, err := os.Stat(thumbnailPath); err == nil {
		return nil
	}

	// Check if source image exists
	if _, err := os.Stat(fullImagePath); os.IsNotExist(err) {
		return fmt.Errorf("source image does not exist: %s", fullImagePath)
	}

	// Create thumbnails directory if it doesn't exist
	if err := os.MkdirAll(thumbnailDir, 0755); err != nil {
		return fmt.Errorf("failed to create thumbnails directory: %w", err)
	}

	// Read source image
	imageData, err := bimg.Read(fullImagePath)
	if err != nil {
		return fmt.Errorf("failed to read image: %w", err)
	}

	// Decode and get image size
	image := bimg.NewImage(imageData)
	size, err := image.Size()
	if err != nil {
		return fmt.Errorf("failed to get image size: %w", err)
	}

	// Calculate new height maintaining aspect ratio
	aspectRatio := float64(size.Height) / float64(size.Width)
	newHeight := int(float64(thumbnailWidth) * aspectRatio)

	// Process image
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

	// Write thumbnail to file
	if err := bimg.Write(thumbnailPath, thumbnailData); err != nil {
		return fmt.Errorf("failed to write thumbnail: %w", err)
	}

	return nil
}

package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type Pass struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Satellite   string `json:"satellite"`
	Timestamp   int64  `json:"timestamp"`
	RawDataPath string `json:"rawDataPath"`
	Downlink    string `json:"downlink"`
}

type Image struct {
	ID         int    `json:"id"`
	Path       string `json:"path"`
	Composite  string `json:"composite"`
	Sensor     string `json:"sensor"`
	MapOverlay int    `json:"mapOverlay"`
	Corrected  int    `json:"corrected"`
	Filled     int    `json:"filled"`
	VPixels    *int   `json:"vPixels"`
	PassID     int    `json:"passId"`
}

type Dataset struct {
	Satellite string  `json:"satellite"`
	Timestamp float64 `json:"timestamp"`
}

type Products struct {
	Products []string `json:"products"`
}

type CompositeCache map[string]struct {
	Time int64 `json:"time"`
}

const (
	maxDirAgeMs = 15 * 60 * 1000 // 15 minutes in milliseconds
)

var (
	dataDir       string
	dbPath        string
	liveOutputDir string
	db            *sql.DB
)

func init() {
	// Get current working directory
	wd, err := os.Getwd()
	if err != nil {
		panic(err)
	}

	dataDir = filepath.Join(wd, "data")
	dbPath = filepath.Join(dataDir, "image_metadata.db")
	liveOutputDir = filepath.Join(wd, "live_output")

	// Ensure data directory exists
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		panic(err)
	}
}

func isImageFile(name string) bool {
	matched, _ := regexp.MatchString(`(?i)\.(jpg|jpeg|png|gif|webp)$`, name)
	return matched
}

func isDirectoryStable(dirPath string) bool {
	stat, err := os.Stat(dirPath)
	if err != nil {
		if os.IsNotExist(err) {
			fmt.Printf("Directory does not exist yet: %s\n", dirPath)
		} else {
			fmt.Printf("Failed to stat directory %s: %v\n", dirPath, err)
		}
		return false
	}

	now := time.Now()
	dirAge := now.Sub(stat.ModTime()).Milliseconds()

	// If directory is older than 15 mins, assume stable
	return dirAge > maxDirAgeMs
}

func extractTimestampFromFolder(folderName string) *int64 {
	re := regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})`)
	matches := re.FindStringSubmatch(folderName)
	if len(matches) != 6 {
		return nil
	}

	year, _ := strconv.Atoi(matches[1])
	month, _ := strconv.Atoi(matches[2])
	day, _ := strconv.Atoi(matches[3])
	hour, _ := strconv.Atoi(matches[4])
	minute, _ := strconv.Atoi(matches[5])

	date := time.Date(year, time.Month(month), day, hour, minute, 0, 0, time.UTC)
	timestamp := date.Unix()
	return &timestamp
}

func getImageDimensions(imagePath string) *int {
	file, err := os.Open(imagePath)
	if err != nil {
		return nil
	}
	defer file.Close()

	config, _, err := image.DecodeConfig(file)
	if err != nil {
		return nil
	}

	height := config.Height
	return &height
}

func initializeDatabase() error {
	var err error
	db, err = sql.Open("sqlite3", dbPath)
	if err != nil {
		return err
	}

	// Check if passes table has required columns
	rows, err := db.Query("PRAGMA table_info(passes)")
	if err == nil {
		var hasDownlink bool
		for rows.Next() {
			var cid int
			var name, dataType string
			var notNull, pk int
			var defaultValue *string

			if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err == nil {
				if name == "downlink" {
					hasDownlink = true
					break
				}
			}
		}
		rows.Close()

		if !hasDownlink {
			db.Exec("DROP TABLE IF EXISTS passes")
			db.Exec("DROP TABLE IF EXISTS images")
		}
	}

	// Create tables with updated schema
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS passes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE,
			satellite TEXT,
			timestamp INTEGER,
			rawDataPath TEXT,
			downlink TEXT
		);

		CREATE TABLE IF NOT EXISTS images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			path TEXT,
			composite TEXT,
			sensor TEXT,
			mapOverlay INTEGER,
			corrected INTEGER,
			filled INTEGER,
			vPixels INTEGER,
			passId INTEGER,
			FOREIGN KEY (passId) REFERENCES passes(id)
		);
	`)

	return err
}

func clearTables() error {
	_, err := db.Exec("DELETE FROM images; DELETE FROM passes;")
	return err
}

func processNOAAAPT(directory string) ([]Image, *Dataset, error) {
	datasetPath := filepath.Join(directory, "dataset.json")
	var dataset Dataset

	if data, err := os.ReadFile(datasetPath); err == nil {
		json.Unmarshal(data, &dataset)
	}

	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, nil, err
	}

	var images []Image
	dirName := filepath.Base(directory)

	for _, entry := range entries {
		if !entry.IsDir() && isImageFile(entry.Name()) {
			vPixels := getImageDimensions(filepath.Join(directory, entry.Name()))

			composite := strings.ToLower(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))
			mapOverlay := 0
			if strings.Contains(strings.ToLower(entry.Name()), "map") {
				mapOverlay = 1
			}

			images = append(images, Image{
				Path:       filepath.Join(dirName, entry.Name()),
				Composite:  composite,
				Sensor:     "AVHRR",
				MapOverlay: mapOverlay,
				Corrected:  1,
				Filled:     1,
				VPixels:    vPixels,
			})
		}
	}

	return images, &dataset, nil
}

func processFormattedL(directory string) ([]Image, *Dataset, error) {
	datasetPath := filepath.Join(directory, "dataset.json")
	var dataset Dataset
	var subdirs Products

	if data, err := os.ReadFile(datasetPath); err == nil {
		json.Unmarshal(data, &dataset)
		json.Unmarshal(data, &subdirs)
	}

	var results []Image
	dirName := filepath.Base(directory)

	for _, subdir := range subdirs.Products {
		fullSubdir := filepath.Join(directory, subdir)
		if _, err := os.Stat(fullSubdir); os.IsNotExist(err) {
			continue
		}

		entries, err := os.ReadDir(fullSubdir)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			if !entry.IsDir() && isImageFile(entry.Name()) {
				vPixels := getImageDimensions(filepath.Join(fullSubdir, entry.Name()))

				composite := strings.ToLower(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))

				corrected := 0
				if subdir != "AVHRR" {
					corrected = 1
				} else if strings.Contains(strings.ToLower(entry.Name()), "corrected") {
					corrected = 1
				}

				mapOverlay := 0
				if strings.Contains(strings.ToLower(entry.Name()), "map") {
					mapOverlay = 1
				}

				results = append(results, Image{
					Path:       filepath.Join(dirName, subdir, entry.Name()),
					Composite:  composite,
					Sensor:     subdir,
					Corrected:  corrected,
					Filled:     1,
					MapOverlay: mapOverlay,
					VPixels:    vPixels,
				})
			}
		}
	}

	return results, &dataset, nil
}

func processMeteorLRPT(directory string) ([]Image, *Dataset, error) {
	datasetPath := filepath.Join(directory, "dataset.json")
	var dataset Dataset

	if data, err := os.ReadFile(datasetPath); err == nil {
		json.Unmarshal(data, &dataset)
	}

	subdirs := []string{"MSU-MR", "MSU-MR (Filled)"}
	var results []Image
	dirName := filepath.Base(directory)

	for _, subdir := range subdirs {
		fullSubdir := filepath.Join(directory, subdir)
		if _, err := os.Stat(fullSubdir); os.IsNotExist(err) {
			continue
		}

		entries, err := os.ReadDir(fullSubdir)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			if !entry.IsDir() && isImageFile(entry.Name()) {
				vPixels := getImageDimensions(filepath.Join(fullSubdir, entry.Name()))

				composite := strings.ToLower(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))

				corrected := 0
				if strings.Contains(strings.ToLower(entry.Name()), "corrected") {
					corrected = 1
				}

				filled := 0
				if strings.Contains(strings.ToLower(subdir), "filled") {
					filled = 1
				}

				mapOverlay := 0
				if strings.Contains(strings.ToLower(entry.Name()), "map") {
					mapOverlay = 1
				}

				results = append(results, Image{
					Path:       filepath.Join(dirName, subdir, entry.Name()),
					Composite:  composite,
					Sensor:     "MSU-MR", // PLACEHOLDER: Set appropriate sensor for Meteor LRPT
					Corrected:  corrected,
					Filled:     filled,
					MapOverlay: mapOverlay,
					VPixels:    vPixels,
				})
			}
		}
	}

	return results, &dataset, nil
}

func processElektroLRIT(directory string) ([]Image, *Dataset, error) {
	cachePath := filepath.Join(directory, ".composite_cache_do_not_delete.json")
	var cacheData CompositeCache

	if data, err := os.ReadFile(cachePath); err == nil {
		json.Unmarshal(data, &cacheData)
	}

	elektroRoot := filepath.Join(directory, "IMAGES", "ELEKTRO-L3")
	if _, err := os.Stat(elektroRoot); os.IsNotExist(err) {
		return []Image{}, nil, nil
	}

	var results []Image
	dirName := filepath.Base(directory)
	entries, err := os.ReadDir(elektroRoot)
	if err != nil {
		return nil, nil, err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			fullFolder := filepath.Join(elektroRoot, entry.Name())
			images, err := os.ReadDir(fullFolder)
			if err != nil {
				continue
			}

			for _, img := range images {
				if !img.IsDir() && isImageFile(img.Name()) {
					composite := strings.ToLower(strings.TrimSuffix(img.Name(), filepath.Ext(img.Name())))

					mapOverlay := 0
					if strings.Contains(strings.ToLower(img.Name()), "map") {
						mapOverlay = 1
					}

					vPixels := 2784

					results = append(results, Image{
						Path:       filepath.Join(dirName, "IMAGES", "ELEKTRO-L3", entry.Name(), img.Name()),
						Composite:  composite,
						Sensor:     "MSU-GS", // PLACEHOLDER: Set appropriate sensor for Elektro LRIT
						Corrected:  1,
						Filled:     1,
						MapOverlay: mapOverlay,
						VPixels:    &vPixels,
					})
				}
			}
		}
	}

	// Create a mock dataset for Elektro
	var timestamp int64
	if len(cacheData) > 0 {
		for _, cache := range cacheData {
			timestamp = cache.Time
			break
		}
	}

	dataset := &Dataset{
		Satellite: "Elektro-L3",
		Timestamp: float64(timestamp),
	}

	return results, dataset, nil
}

func processFengyunSVISSR(directory string) ([]Image, *Dataset, error) {
	imageRoot := filepath.Join(directory, "IMAGE")
	if _, err := os.Stat(imageRoot); os.IsNotExist(err) {
		return []Image{}, nil, nil
	}

	var results []Image
	dirName := filepath.Base(directory)
	entries, err := os.ReadDir(imageRoot)
	if err != nil {
		return nil, nil, err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			fullFolder := filepath.Join(imageRoot, entry.Name())
			images, err := os.ReadDir(fullFolder)
			if err != nil {
				continue
			}

			for _, img := range images {
				if !img.IsDir() && isImageFile(img.Name()) {
					composite := strings.ToLower(strings.TrimSuffix(img.Name(), filepath.Ext(img.Name())))

					mapOverlay := 0
					if strings.Contains(strings.ToLower(img.Name()), "map") {
						mapOverlay = 1
					}

					vPixels := 2501

					results = append(results, Image{
						Path:       filepath.Join(dirName, "IMAGE", entry.Name(), img.Name()),
						Composite:  composite,
						Sensor:     "SVISSR", // PLACEHOLDER: Set appropriate sensor for FengYun SVISSR
						Corrected:  1,
						Filled:     1,
						MapOverlay: mapOverlay,
						VPixels:    &vPixels,
					})
				}
			}
		}
	}

	// Create a mock dataset for FengYun
	dataset := &Dataset{
		Satellite: "FengYun",
		Timestamp: 0, // Will be extracted from folder name
	}

	return results, dataset, nil
}

func processProba2(directory string) ([]Image, *Dataset, error) {
	imagesRoot := filepath.Join(directory, "SWAP")
	if _, err := os.Stat(imagesRoot); os.IsNotExist(err) {
		return []Image{}, nil, nil
	}

	var results []Image
	dirName := filepath.Base(directory)
	entries, err := os.ReadDir(imagesRoot)
	if err != nil {
		return nil, nil, err
	}
	for _, entry := range entries {
		if !entry.IsDir() && isImageFile(entry.Name()) {
			composite := strings.ToLower(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))

			vPixels := 1024

			results = append(results, Image{
				Path:       filepath.Join(dirName, "SWAP", entry.Name()),
				Composite:  composite,
				Sensor:     "SWAP",
				Corrected:  1,
				Filled:     1,
				MapOverlay: 0,
				VPixels:    &vPixels,
			})
		}
	}

	// Create a mock dataset for FengYun
	dataset := &Dataset{
		Satellite: "Proba2",
		Timestamp: 0, // Will be extracted from folder name
	}

	return results, dataset, nil
}

func processProbaV(directory string) ([]Image, *Dataset, error) {
	imagesRoot := filepath.Join(directory, "Vegetation")
	if _, err := os.Stat(imagesRoot); os.IsNotExist(err) {
		return []Image{}, nil, nil
	}

	var results []Image
	dirName := filepath.Base(directory)
	entries, err := os.ReadDir(imagesRoot)
	if err != nil {
		return nil, nil, err
	}
	for _, entry := range entries {
		if !entry.IsDir() && isImageFile(entry.Name()) {
			composite := strings.ToLower(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))

			vPixels := 1024

			results = append(results, Image{
				Path:       filepath.Join(dirName, "Vegetation", entry.Name()),
				Composite:  composite,
				Sensor:     "VNIR",
				Corrected:  1,
				Filled:     1,
				MapOverlay: 0,
				VPixels:    &vPixels,
			})
		}
	}

	// Create a mock dataset for FengYun
	dataset := &Dataset{
		Satellite: "ProbaV",
		Timestamp: 0, // Will be extracted from folder name
	}

	return results, dataset, nil
}

func processUVSQ_NG(directory string) ([]Image, *Dataset, error) {
	if _, err := os.Stat(directory); os.IsNotExist(err) {
		return []Image{}, nil, nil
	}

	var results []Image
	dirName := filepath.Base(directory)
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, nil, err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			fullFolder := filepath.Join(directory, entry.Name())
			images, err := os.ReadDir(fullFolder)
			if err != nil {
				continue
			}

			for _, img := range images {
				if !img.IsDir() && isImageFile(img.Name()) {
					composite := strings.ToLower(strings.TrimSuffix(img.Name(), filepath.Ext(img.Name())))

					vPixels := 2501

					results = append(results, Image{
						Path:       filepath.Join(dirName, entry.Name(), img.Name()),
						Composite:  composite,
						Sensor:     "NanoCam",
						Corrected:  1,
						Filled:     1,
						MapOverlay: 0,
						VPixels:    &vPixels,
					})
				}
			}
		}
	}

	// Create a mock dataset for FengYun
	dataset := &Dataset{
		Satellite: "UVSQ-NG",
		Timestamp: 0,
	}

	return results, dataset, nil
}

func processPass(passFolder string, images []Image, dataset *Dataset) error {
	var rawDataPath *string
	satellite := "Unknown"
	var timestamp *int64
	passPath := filepath.Join(liveOutputDir, passFolder)
	downlink := "PLACEHOLDER_DOWNLINK" // PLACEHOLDER: Set appropriate downlink type

	if dataset != nil {
		if dataset.Satellite != "" {
			satellite = dataset.Satellite
		}
		if dataset.Timestamp > 0 {
			ts := int64(dataset.Timestamp)
			timestamp = &ts
		}
		if timestamp == nil || *timestamp < 1 || *timestamp > 1750100000000 {
			timestamp = extractTimestampFromFolder(passFolder)
		}
	}

	// Find .cadu files in pass directory
	entries, err := os.ReadDir(passPath)
	if err == nil {
		for _, entry := range entries {
			if strings.HasSuffix(strings.ToLower(entry.Name()), ".cadu") || strings.HasSuffix(strings.ToLower(entry.Name()), ".raw16") {
				if entry.Name() != "others.cadu" {
					caduPath := entry.Name()
					rawDataPath = &caduPath
					break
				}
			}
		}
	}

	// Handle specific satellite logic and set appropriate downlink types
	if strings.Contains(strings.ToLower(satellite), "meteor") {
		if strings.Contains(strings.ToLower(passFolder), "lrpt") {
			downlink = "VHF"
		} else if strings.Contains(strings.ToLower(passFolder), "hrpt") {
			downlink = "L Band"
		}
	} else if strings.Contains(strings.ToLower(satellite), "fengyun") {
		timestamp = extractTimestampFromFolder(passFolder)
		downlink = "L Band"
	} else if strings.Contains(strings.ToLower(satellite), "elektro") {
		downlink = "L Band"
	} else if strings.Contains(strings.ToLower(satellite), "aws") {
		downlink = "L Band"
	} else if strings.Contains(strings.ToLower(satellite), "proba") {
		downlink = "S Band"
		timestamp = extractTimestampFromFolder(passFolder)
	} else if strings.Contains(strings.ToLower(satellite), "uvsq") {
		downlink = "S Band"
		timestamp = extractTimestampFromFolder(passFolder)
	} else if strings.Contains(strings.ToLower(satellite), "noaa") {
		if strings.Contains(strings.ToLower(passFolder), "apt") {
			downlink = "VHF"
		} else if strings.Contains(strings.ToLower(passFolder), "hrpt") {
			downlink = "L Band"
		}
	} else if strings.Contains(strings.ToLower(satellite), "metop") {
		downlink = "L Band"
	}

	// Insert pass
	var result sql.Result
	if rawDataPath != nil {
		result, err = db.Exec(`
			INSERT OR REPLACE INTO passes (name, satellite, timestamp, rawDataPath, downlink)
			VALUES (?, ?, ?, ?, ?)
		`, passFolder, satellite, timestamp, *rawDataPath, downlink)
	} else { //If no .cadu or .raw16 found, insert nil
		result, err = db.Exec(`
			INSERT OR REPLACE INTO passes (name, satellite, timestamp, rawDataPath, downlink)
			VALUES (?, ?, ?, ?, ?)
		`, passFolder, satellite, timestamp, nil, downlink)
	}

	if err != nil {
		return err
	}

	passID, err := result.LastInsertId()
	if err != nil {
		return err
	}

	// Insert images
	for _, img := range images {
		_, err := db.Exec(`
			INSERT INTO images (path, composite, sensor, mapOverlay, corrected, filled, vPixels, passId)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, img.Path, img.Composite, img.Sensor, img.MapOverlay, img.Corrected, img.Filled, img.VPixels, passID)

		if err != nil {
			return err
		}
	}

	return nil
}

func processPasses(mode int8, path string) error {
	directories, err := os.ReadDir(path)
	if err != nil {
		fmt.Println("Error getting directory entries", err)
		return err
	}

	addedCount := 0

	for _, i := range directories {
		if !i.IsDir() {
			continue
		}

		dirname := i.Name()
		fullPath := filepath.Join(path, dirname)

		var images []Image
		var dataset *Dataset
		var processErr error

		switch {
		case strings.Contains(strings.ToLower(dirname), "noaa") && strings.Contains(strings.ToLower(dirname), "apt"):
			images, dataset, processErr = processNOAAAPT(fullPath)
		case strings.Contains(strings.ToLower(dirname), "noaa") && strings.Contains(strings.ToLower(dirname), "hrpt"):
			images, dataset, processErr = processFormattedL(fullPath)
		case strings.Contains(strings.ToLower(dirname), "metop") && strings.Contains(strings.ToLower(dirname), "ahrpt"):
			images, dataset, processErr = processFormattedL(fullPath)
		case strings.Contains(strings.ToLower(dirname), "meteor") && strings.Contains(strings.ToLower(dirname), "lrpt"):
			images, dataset, processErr = processMeteorLRPT(fullPath)
		case strings.Contains(strings.ToLower(dirname), "meteor") && strings.Contains(strings.ToLower(dirname), "hrpt"):
			images, dataset, processErr = processFormattedL(fullPath)
		case strings.Contains(strings.ToLower(dirname), "aws") && strings.Contains(strings.ToLower(dirname), "pfm"):
			images, dataset, processErr = processFormattedL(fullPath)
		case strings.Contains(strings.ToLower(dirname), "elektro") && strings.Contains(strings.ToLower(dirname), "lrit"):
			images, dataset, processErr = processElektroLRIT(fullPath)
		case strings.Contains(strings.ToLower(dirname), "uvsq") && strings.Contains(strings.ToLower(dirname), "ng"):
			images, dataset, processErr = processUVSQ_NG(fullPath)
		case strings.Contains(strings.ToLower(dirname), "proba2"):
			images, dataset, processErr = processProba2(fullPath)
		case strings.Contains(strings.ToLower(dirname), "probav"):
			images, dataset, processErr = processProbaV(fullPath)
		case strings.Contains(strings.ToLower(dirname), "fengyun") && strings.Contains(strings.ToLower(dirname), "svissr"):
			images, dataset, processErr = processFengyunSVISSR(fullPath)
		default:
			fmt.Println("Skipping possible pass:", dirname, "due to not being set up.")
			continue
		}

		if processErr != nil {
			fmt.Printf("Error processing %s: %v\n", dirname, processErr)
			continue
		}

		switch mode {
		case 0: // repopulate
			if err := processPass(dirname, images, dataset); err != nil {
				fmt.Printf("Error inserting pass %s: %v\n", dirname, err)
				continue
			}
			addedCount++
		case 1: // update
			// Check if pass already exists
			var exists int
			err := db.QueryRow("SELECT 1 FROM passes WHERE name = ?", dirname).Scan(&exists)
			if err == nil {
				continue // Skip if already exists
			}

			if !isDirectoryStable(fullPath) {
				fmt.Printf("%s may be updating at this time; skipping...\n", dirname)
				continue
			}

			if err := processPass(dirname, images, dataset); err != nil {
				fmt.Printf("Error inserting pass %s: %v\n", dirname, err)
				continue
			}
			addedCount++
		}
	}

	switch mode {
	case 0:
		fmt.Printf("Database population complete. Passes found: %d\n", addedCount)
	case 1:
		fmt.Printf("Database has been updated. Added %d passes\n", addedCount)
	}

	return nil
}

func main() {
	args := os.Args
	if len(args) < 2 {
		fmt.Println("Usage: go run main.go [repopulate|update|rebuild]")
		return
	}

	fmt.Println("All arguments:", args)
	fmt.Println("User arguments:", args[1])

	dir, err := os.Getwd()
	if err != nil {
		fmt.Println("Error getting current directory:", err)
		return
	}
	fmt.Println("Current directory:", dir)

	// Initialize database
	if err := initializeDatabase(); err != nil {
		fmt.Printf("Error initializing database: %v\n", err)
		return
	}
	defer db.Close()

	switch args[1] {
	case "repopulate":
		fmt.Println("Repopulating...")
		start := time.Now()
		if err := clearTables(); err != nil {
			fmt.Printf("Error clearing tables: %v\n", err)
			return
		}
		processPasses(0, liveOutputDir)
		fmt.Println(time.Since(start), "taken to repopulate")
	case "update":
		// Check if table exists
		var tableName string
		err := db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='passes'").Scan(&tableName)
		if err != nil {
			fmt.Println("Table 'passes' does not exist. Falling back to repopulate.")
			if err := clearTables(); err != nil {
				fmt.Printf("Error clearing tables: %v\n", err)
				return
			}
			processPasses(0, liveOutputDir)
		} else {
			fmt.Println("Updating...")
			processPasses(1, liveOutputDir)
		}
	case "rebuild":
		fmt.Println("Rebuilding...")
		if err := os.Remove(dbPath); err != nil && !os.IsNotExist(err) {
			fmt.Printf("Error removing database: %v\n", err)
			return
		}
		fmt.Println("Deleted existing database.")

		// Reinitialize database
		if err := initializeDatabase(); err != nil {
			fmt.Printf("Error reinitializing database: %v\n", err)
			return
		}
		fmt.Println("Database initialized")

		processPasses(0, liveOutputDir)
	default:
		fmt.Println("No command accepted.")
	}
}

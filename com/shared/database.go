package shared

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

type Database struct {
	*sql.DB
	Path string
}

type Config struct {
	DataDir       string
	DBPath        string
	LiveOutputDir string
}

func NewConfigFromAppConfig(appConfig interface{}) (*Config, error) {
	// Fallbacks: current working directory layout
	wd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("failed to get working directory: %w", err)
	}
	dataDir := filepath.Join(wd, "data")
	liveOut := filepath.Join(wd, "live_output")

	// Try to read from the provided app config without a hard dependency on its type:
	// marshal → unmarshal into a light struct that mirrors the fields we need.
	var lite struct {
		Paths struct {
			DataDir       string `json:"data_dir" toml:"data_dir"`
			LiveOutputDir string `json:"live_output_dir" toml:"live_output_dir"`
		} `json:"paths" toml:"paths"`
		Database struct {
			Path string `json:"path" toml:"path"` // deprecated, only used to keep parent dir creation elsewhere
		} `json:"database" toml:"database"`
	}
	if b, err := json.Marshal(appConfig); err == nil {
		_ = json.Unmarshal(b, &lite)
		if strings.TrimSpace(lite.Paths.DataDir) != "" {
			dataDir = lite.Paths.DataDir
		}
		if strings.TrimSpace(lite.Paths.LiveOutputDir) != "" {
			liveOut = lite.Paths.LiveOutputDir
		}
	}

	return &Config{
		DataDir:       dataDir,
		DBPath:        filepath.Join(dataDir, "image_metadata.db"),
		LiveOutputDir: liveOut,
	}, nil
}

// open a database connection with options
func OpenDatabase(config *Config) (*Database, error) {
	db, err := sql.Open("sqlite3", config.DBPath+"?cache=shared&mode=rwc&_journal_mode=WAL&_synchronous=NORMAL&_cache_size=10000")
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// database settings
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	// Test connection
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &Database{
		DB:   db,
		Path: config.DBPath,
	}, nil
}

func (db *Database) Close() error {
	return db.DB.Close()
}

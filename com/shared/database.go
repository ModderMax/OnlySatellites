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

type AppConfig struct {
	DataDir       string
	DBPath        string
	LiveOutputDir string
}

func NewConfigFromAppConfig(appConfig interface{}) (*AppConfig, error) {
	// Fallback to working directory
	wd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("failed to get working directory: %w", err)
	}
	dataDir := filepath.Join(wd, "data")
	liveOut := filepath.Join(wd, "live_output")

	var lite struct {
		Paths struct {
			DataDir       string `json:"data_dir" toml:"data_dir"`
			LiveOutputDir string `json:"live_output_dir" toml:"live_output_dir"`
		} `json:"paths" toml:"paths"`
		Database struct {
			Path string `json:"path" toml:"path"` // deprecated
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

	return &AppConfig{
		DataDir:       dataDir,
		DBPath:        filepath.Join(dataDir, "image_metadata.db"),
		LiveOutputDir: liveOut,
	}, nil
}

func OpenDatabase(config *AppConfig) (*Database, error) {
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

func OpenAnalDB(dataDir string) (*sql.DB, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	dbPath := filepath.Join(dataDir, "aggregateData.db")
	db, err := sql.Open("sqlite3", dbPath+"?cache=shared&mode=rwc&_journal_mode=WAL&_synchronous=NORMAL&_cache_size=10000")
	if err != nil {
		return nil, fmt.Errorf("failed to open aggregate database: %w", err)
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping aggregate database: %w", err)
	}
	return db, nil
}

func InitSchema(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS satdump_readings (
	ts BIGINT NOT NULL,
	instance TEXT,
	data JSON
);`)
	if err != nil {
		return err
	}

	type colInfo struct {
		name string
	}
	rows, err := db.Query(`PRAGMA table_info(satdump_readings);`)
	if err != nil {
		return err
	}
	defer rows.Close()

	hasInstance := false
	for rows.Next() {
		var (
			cid       int
			name      string
			colType   string
			notNull   int
			dfltValue sql.NullString
			pk        int
		)
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			return err
		}
		if name == "instance" {
			hasInstance = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !hasInstance {
		if _, err := db.Exec(`ALTER TABLE satdump_readings ADD COLUMN instance TEXT;`); err != nil {
			return err
		}
	}
	return nil
}

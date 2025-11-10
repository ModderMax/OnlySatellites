package config

import (
	"fmt"
	"os"

	"github.com/pelletier/go-toml/v2"
)

// Core Config Structures

type AppConfig struct {
	Server       ServerConfig       `toml:"server"`
	Database     DatabaseConfig     `toml:"database"`
	Paths        PathsConfig        `toml:"paths"`
	Thumbgen     ThumbgenConfig     `toml:"thumbgen"`
	StationProxy StationProxyConfig `toml:"stationproxy"`
}

type PassConfig struct {
	Composites map[string]string         `toml:"composites"`
	PassTypes  map[string]PassTypeConfig `toml:"passTypes"`
	Passes     PassesConfig              `toml:"passes"`
}

// App Config Sections

type ServerConfig struct {
	Port         string `toml:"port"`
	ReadTimeout  int    `toml:"read_timeout"`
	WriteTimeout int    `toml:"write_timeout"`
	LogLevel     string `toml:"log_level"`
}

type DatabaseConfig struct {
	MaxOpenConns    int `toml:"max_open_conns"`
	MaxIdleConns    int `toml:"max_idle_conns"`
	ConnMaxLifetime int `toml:"conn_max_lifetime"`
	CacheSize       int `toml:"cache_size"`
}

type PathsConfig struct {
	DataDir       string `toml:"data_dir"`
	LiveOutputDir string `toml:"live_output_dir"`
	ThumbnailDir  string `toml:"thumbnail_dir"`
	LogDir        string `toml:"log_dir"`
}

type ThumbgenConfig struct {
	MaxWorkers     int `toml:"max_workers"`
	BatchSize      int `toml:"batch_size"`
	ThumbnailWidth int `toml:"thumbnail_width"`
	Quality        int `toml:"quality"`
}

type StationProxyConfig struct {
	Enabled       bool   `toml:"enabled"`
	StationId     string `toml:"station_name"`
	StationSecret string `toml:"station_secret"`
	FrpsAddr      string `toml:"frps_addr"`
	FrpsPort      int    `toml:"frps_port"`
}

// Pass Config Structures

type ImageDirConfig struct {
	IsFilled    bool   `toml:"isFilled"`
	VPix        int    `toml:"vPix"`
	Sensor      string `toml:"sensor"`
	IsCorrected bool   `toml:"corrected"`
	Composite   string `toml:"composite"`
}

type PassTypeConfig struct {
	DatasetFile string
	RawDataFile string
	Downlink    string
	ImageDirs   map[string]ImageDirConfig
}

type PassesConfig struct {
	FolderIncludes map[string]string `toml:"folderincludes"`
}

// Defaults & Loaders

func DefaultConfig() (*AppConfig, *PassConfig) {
	return &AppConfig{
			Server: ServerConfig{
				Port:         ":1500",
				ReadTimeout:  30,
				WriteTimeout: 30,
			},
			Database: DatabaseConfig{
				MaxOpenConns:    1,
				MaxIdleConns:    1,
				ConnMaxLifetime: 0,
				CacheSize:       10000,
			},
			Paths: PathsConfig{
				DataDir:       "data",
				LiveOutputDir: "live_output",
				ThumbnailDir:  "",
				LogDir:        "logs",
			},
			Thumbgen: ThumbgenConfig{
				MaxWorkers:     4,
				BatchSize:      1000,
				ThumbnailWidth: 200,
				Quality:        75,
			},
		}, &PassConfig{
			Composites: map[string]string{},
			PassTypes:  map[string]PassTypeConfig{},
			Passes:     PassesConfig{FolderIncludes: map[string]string{}},
		}
}

func LoadConfig(coreConfigPath string) (*AppConfig, *PassConfig, error) {
	cfg, passesCfg := DefaultConfig()

	// Load main config.toml
	if _, err := os.Stat(coreConfigPath); err == nil {
		data, err := os.ReadFile(coreConfigPath)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to read core config file: %w", err)
		}
		if err := toml.Unmarshal(data, cfg); err != nil {
			return nil, nil, fmt.Errorf("failed to parse core TOML config: %w", err)
		}
	}

	// Ensure directories exist
	if err := cfg.ensureDirectories(); err != nil {
		return nil, nil, fmt.Errorf("failed to create directories: %w", err)
	}

	return cfg, passesCfg, nil
}

func (c *AppConfig) ensureDirectories() error {
	dirs := []string{
		c.Paths.DataDir,
		c.Paths.LiveOutputDir,
		c.Paths.LogDir,
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}
	if c.Paths.ThumbnailDir != "" {
		if err := os.MkdirAll(c.Paths.ThumbnailDir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", c.Paths.ThumbnailDir, err)
		}
	}
	return nil
}

func SaveConfig(path string, cfg *AppConfig) error {
	data, err := toml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

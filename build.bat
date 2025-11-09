@echo off

set GOOS=windows
set GOARCH=amd64
set CGO_ENABLED=1

go build -o OnlySats.exe main.go
if %ERRORLEVEL% neq 0 (
    echo Failed to build main application
    exit /b 1
)

echo Build completed successfully!

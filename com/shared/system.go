package shared

import (
	"bufio"
	"log"
	"net"
	"os"
	"sort"
	"strings"
)

func GetHostIPv4() string {
	logFile := "logs/system.log"
	lf, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return "127.0.0.1"
	}
	defer lf.Close()
	bufWriter := bufio.NewWriterSize(lf, 1<<20) // 1MB buffer to reduce disk I/O
	logger := log.New(bufWriter, "", log.LstdFlags)
	ifaces, _ := net.Interfaces()
	candidates := []struct {
		name     string
		addr     string
		priority int
	}{}

	logger.Println("Scanning network interfaces...")

	for _, iface := range ifaces {
		// Skip interfaces that are down or not running
		if iface.Flags&net.FlagUp == 0 {
			logger.Printf("Skipping %s: interface down", iface.Name)
			continue
		}

		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok || ipnet.IP.IsLoopback() {
				continue
			}
			ipv4 := ipnet.IP.To4()
			if ipv4 == nil || ipv4.IsUnspecified() {
				continue
			}

			ipStr := ipv4.String()
			logger.Printf("Found candidate: iface=%s addr=%s", iface.Name, ipStr)

			// Skip APIPA range (169.254.x.x)
			if strings.HasPrefix(ipStr, "169.254.") {
				logger.Printf("Skipping APIPA address: %s", ipStr)
				continue
			}

			// Assign priority based on interface name
			name := strings.ToLower(iface.Name)
			priority := 99
			if strings.Contains(name, "ethernet") {
				priority = 1
			} else if strings.Contains(name, "wi-fi") || strings.Contains(name, "wifi") {
				priority = 2
			}

			logger.Printf("Keeping candidate: %s (priority=%d)", ipStr, priority)
			candidates = append(candidates, struct {
				name     string
				addr     string
				priority int
			}{iface.Name, ipStr, priority})
		}
	}

	if len(candidates) == 0 {
		logger.Println("No valid candidates found, falling back to 127.0.0.1")
		return "127.0.0.1"
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].priority < candidates[j].priority
	})

	chosen := candidates[0]
	logger.Printf("Chosen IP: %s (iface=%s priority=%d)", chosen.addr, chosen.name, chosen.priority)
	bufWriter.Flush()
	return chosen.addr
}

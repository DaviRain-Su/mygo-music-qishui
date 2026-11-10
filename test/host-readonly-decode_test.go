package player

import (
	"io"
	"math"
	"os"
	"testing"
)

// Decode the authorized live probe through MyGo's own audio entry point.
func TestQishuiReadonlyDecode(t *testing.T) {
	b, err := os.ReadFile(os.Getenv("QISHUI_PROBE_AUDIO"))
	if err != nil {
		t.Fatal("private authorized decoder input unavailable")
	}
	s, err := openStream(downloaded(b), 0)
	if err != nil {
		t.Fatal("MyGo rejected the authorized audio container")
	}
	defer s.Close()
	buffer := make([]float32, 8192)
	total, audible := 0, false
	for {
		n, err := s.Read(buffer)
		if n < 0 || n > len(buffer) || n%2 != 0 {
			t.Fatal("invalid PCM count")
		}
		for _, value := range buffer[:n] {
			if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
				t.Fatal("nonfinite PCM")
			}
			audible = audible || value != 0
		}
		total += n
		if err == io.EOF {
			break
		}
		if err != nil || n == 0 || total > s.SampleRate()*2*3600 {
			t.Fatal("audio decode interrupted or exceeded bounds")
		}
	}
	if total == 0 || !audible {
		t.Fatal("decoded audio was empty or silent")
	}
	t.Logf("MyGo decoded to EOF: rate=%d frames=%d", s.SampleRate(), total/2)
}

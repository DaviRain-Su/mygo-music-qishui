package plugin

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/MoeForge/moejs"
	"mygo-music/internal/music"
)

type qishuiReadonlyTransport struct{ base http.RoundTripper }

func (r qishuiReadonlyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	allowed := req.Method == "GET" && req.URL.Hostname() == "127.0.0.1" && req.URL.Scheme == "http"
	if req.URL.Host == "api.qishui.com" && req.URL.Scheme == "https" {
		switch req.URL.Path {
		case "/luna/pc/me", "/luna/pc/me/recently-played-media", "/luna/search/track", "/luna/pc/search/track":
			allowed = req.Method == "GET"
		case "/luna/pc/discover", "/luna/pc/discover/mix", "/luna/pc/track_v2", "/luna/pc/commerce/v2/commerce_info", "/luna/pc/feed/mode":
			allowed = req.Method == "POST"
		case "/luna/pc/feed/song-tab":
			body, err := io.ReadAll(io.LimitReader(req.Body, 131073))
			req.Body = io.NopCloser(bytes.NewReader(body))
			var preview struct {
				Played      []json.RawMessage `json:"played_media"`
				FirstDevice bool              `json:"is_did_first_request"`
			}
			allowed = err == nil && len(body) <= 131072 && json.Unmarshal(body, &preview) == nil && len(preview.Played) == 0 && !preview.FirstDevice && req.Method == "POST"
		}
	}
	if !allowed {
		return nil, errors.New("read-only probe blocked an unapproved request")
	}
	response, err := r.base.RoundTrip(req)
	if err == nil && req.URL.Path == "/luna/pc/discover" {
		raw, readErr := io.ReadAll(io.LimitReader(response.Body, 8*1048576+1))
		response.Body.Close()
		response.Body = io.NopCloser(bytes.NewReader(raw))
		fmt.Printf("discovery transport: HTTP=%d bytes=%d\n", response.StatusCode, len(raw))
		if readErr == nil && len(raw) <= 8*1048576 {
			var parsed map[string]json.RawMessage
			if json.Unmarshal(raw, &parsed) == nil {
				keys := make([]string, 0, len(parsed))
				for key := range parsed {
					keys = append(keys, key)
				}
				sort.Strings(keys)
				var blocks []struct {
					Inner []struct {
						Resources []struct {
							Entity map[string]json.RawMessage `json:"entity"`
						} `json:"resources"`
					} `json:"inner_block"`
				}
				json.Unmarshal(parsed["blocks"], &blocks)
				entities := map[string]int{}
				for _, block := range blocks {
					for _, inner := range block.Inner {
						for _, resource := range inner.Resources {
							for key := range resource.Entity {
								entities[key]++
							}
						}
					}
				}
				fmt.Printf("discovery response: HTTP=%d fields=%v blocks=%d entityKinds=%v\n", response.StatusCode, keys, len(blocks), entities)
			}
		}
	}
	return response, err
}

// Verify real account restoration and authorized audio using only temporary storage.
func TestQishuiReadonlyServices(t *testing.T) {
	original := os.Getenv("QISHUI_PROBE_STORAGE")
	if original == "" {
		t.Skip("private storage input not provided")
	}
	raw, err := os.ReadFile(original)
	if err != nil {
		t.Fatal("cannot read private account input")
	}
	hash := sha256.Sum256(raw)
	t.Cleanup(func() {
		after, err := os.ReadFile(original)
		if err != nil || sha256.Sum256(after) != hash {
			t.Error("original account storage changed")
		}
	})
	data := t.TempDir()
	if os.Mkdir(filepath.Join(data, "qishui"), 0700) != nil {
		t.Fatal("cannot create private temporary account directory")
	}
	if os.WriteFile(filepath.Join(data, "qishui", "storage.json"), raw, 0600) != nil {
		t.Fatal("cannot create private temporary account input")
	}
	transport := http.DefaultTransport
	http.DefaultTransport = qishuiReadonlyTransport{transport}
	t.Cleanup(func() { http.DefaultTransport = transport })
	t.Setenv("PATH", "/usr/bin:/bin")
	p, err := Load(os.Getenv("QISHUI_PLUGIN_DIR"), data)
	if err != nil {
		t.Fatal("cannot load final plugin")
	}
	defer p.Close()
	if os.Getenv("QISHUI_PROBE_DIAGNOSTIC") == "1" {
		bundle, _ := os.ReadFile(filepath.Join(os.Getenv("QISHUI_PLUGIN_DIR"), "index.js"))
		original := `throw authError(error2.kind === "canceled" ? "network" : error2.kind);`
		replacement := `throw fail("", "probe kind=" + String(error2.kind) + " type=" + String(error2.name) + " cause=" + String(error2.message).slice(0, 128));`
		diagnostic := strings.Replace(string(bundle), original, replacement, 1)
		if diagnostic == string(bundle) {
			t.Fatal("diagnostic hook not found")
		}
		p.mod, err = moejs.Compile("index.js", diagnostic)
		if err != nil {
			t.Fatal("cannot compile private diagnostic entry")
		}
	}
	if p.Grant(true) != nil {
		t.Fatal("cannot grant temporary plugin process permission")
	}
	account, err := p.Account()
	if err != nil || account == nil {
		t.Fatal("real account verification did not succeed; original storage preserved")
	}
	t.Log("real account verification passed")
	start := time.Now()
	home, err := p.Home()
	if err != nil || home == nil {
		t.Fatal("real signed home request failed")
	}
	t.Logf("real signed home passed: sections=%d", len(home.Sections))
	if os.Getenv("QISHUI_PROBE_PRESENTATION_ONLY") == "1" {
		if len(home.Sections) < 2 || len(home.Sections[0].Tracks) == 0 || len(home.Sections[1].Stations) < 3 || home.Sections[1].Stations[0].ID != "recommendations" {
			t.Fatal("personal recommendations did not lead the home")
		}
		t.Logf("first home composition: elapsed_ms=%d tracks=%d", time.Since(start).Milliseconds(), len(home.Sections[0].Tracks))
		pages := map[string]*music.Browse{"home": home}
		for _, id := range []string{"listening-modes", "scene-modes"} {
			start = time.Now()
			page, err := p.Browse(id)
			if err != nil || page == nil {
				t.Fatalf("real mode presentation failed: %s", id)
			}
			pages[id] = page
			t.Logf("real mode presentation: page=%s elapsed_ms=%d stations=%d", id, time.Since(start).Milliseconds(), len(page.Sections[0].Stations))
		}
		stations, err := p.Stations()
		if err != nil || len(stations) != 3 {
			t.Fatal("personal station list failed")
		}
		covers := map[string]string{}
		for _, page := range pages {
			for i := range page.Sections {
				section := &page.Sections[i]
				for j := range section.Tracks {
					track := &section.Tracks[j]
					*track = music.Track{ID: fmt.Sprint(j + 1), Name: fmt.Sprintf("推荐歌曲 %02d", j+1), Source: "fake", Duration: track.Duration, Album: music.Album{ImageURL: track.Album.ImageURL}, Artists: []music.Artist{{Name: "推荐艺人"}}}
					if track.Album.ImageURL != "" {
						covers[track.Album.ImageURL] = ""
					}
				}
				for j := range section.Stations {
					station := &section.Stations[j]
					if strings.HasPrefix(station.ID, "radio:") {
						station.ID = fmt.Sprintf("radio:preview-%d", j)
						station.Name = fmt.Sprintf("发现电台 %d", j+1)
						station.Description = ""
					}
					if station.ImageURL != "" {
						covers[station.ImageURL] = ""
					}
				}
				for j := range section.Playlists {
					playlist := &section.Playlists[j]
					*playlist = music.Playlist{ID: fmt.Sprint(j), Name: fmt.Sprintf("精选歌单 %d", j+1), ImageURL: playlist.ImageURL}
					if playlist.ImageURL != "" {
						covers[playlist.ImageURL] = ""
					}
				}
			}
		}
		if len(covers) == 0 {
			t.Fatal("no real music covers were returned")
		}
		output, err := json.Marshal(map[string]any{"pages": pages, "stations": stations, "tracks": home.Sections[0].Tracks, "covers": covers})
		if err != nil || os.WriteFile(os.Getenv("QISHUI_PRESENTATION_FIXTURE"), output, 0600) != nil {
			t.Fatal("cannot stage sanitized presentation fixture")
		}
		t.Logf("sanitized UI fixture prepared: covers=%d (no account, song titles, history or credentials)", len(covers))
		return
	}
	for _, page := range []string{"discover", "charts"} {
		result, err := p.Browse(page)
		if err != nil || result == nil {
			t.Fatalf("real legacy navigation failed: %s (%v)", page, err)
		}
		t.Logf("real %s passed: sections=%d", page, len(result.Sections))
	}
	found, err := p.Search("晴天", music.SearchTracks, 0)
	if err != nil || found == nil || len(found.Tracks) == 0 {
		t.Fatal("real public search failed")
	}
	t.Logf("real search passed: tracks=%d", len(found.Tracks))
	candidates, err := p.Recent()
	if err != nil {
		t.Fatal("real signed history read failed")
	}
	if len(candidates) == 0 {
		candidates = found.Tracks
	}
	for _, track := range candidates[:min(3, len(candidates))] {
		stream, err := p.Stream(track.ID, "high")
		if err != nil || stream == nil {
			continue
		}
		response, err := http.Get(stream.URL)
		if err != nil {
			t.Fatal("private audio bridge unavailable")
		}
		audio, err := io.ReadAll(io.LimitReader(response.Body, 128*1024*1024+1))
		response.Body.Close()
		if err != nil || response.StatusCode != 200 || len(audio) == 0 || len(audio) > 128*1024*1024 {
			t.Fatal("private audio bridge returned invalid audio")
		}
		if os.WriteFile(os.Getenv("QISHUI_PROBE_AUDIO"), audio, 0600) != nil {
			t.Fatal("cannot stage temporary decoder input")
		}
		t.Logf("real authorized stream passed: type=%s bytes=%d", stream.Type, len(audio))
		return
	}
	t.Fatal("none of the sampled tracks provided a supported authorized stream")
}

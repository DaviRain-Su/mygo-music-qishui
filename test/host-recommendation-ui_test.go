package app

import (
	"fmt"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
	"mygo-music/internal/music"
)

// Use real plugin DTOs with anonymized songs and downloaded public album art.
func TestQishuiRecommendationHomeAndModes(t *testing.T) {
	fixture := loadQishuiSceneFixtures(t)
	for _, dark := range []bool{false, true} {
		for _, width := range []int{1000, 1440} {
			a := qishuiSceneApp(t, fixture)
			ch := posts(a)
			a.home = fixture.Pages["home"]
			a.route = route{page: pageHome, src: "fake"}
			asked := make(chan string, 8)
			fake(a).stationNext = func(id string) ([]music.Track, error) { asked <- id; return sourced(fixture.Tracks...), nil }
			tt := ui.NewTester(a.view, width, 1000)
			tt.SetDark(dark)
			settled(tt)
			if _, ok := tt.Find(a.home.Sections[0].Title); !ok {
				t.Fatal("recommendation feature is missing")
			}
			theme := "light"
			if dark {
				theme = "dark"
			}
			saveFrame(t, framesDir(t), fmt.Sprintf("home-%s-%d.png", theme, width), tt.Image())
			if err := tt.Click("猜你喜欢"); err != nil {
				t.Fatal("continuous personalized station is not reachable on home")
			}
			if id := wait(t, asked, "personalized radio"); id != "recommendations" {
				t.Fatal("home lost personalized recommendation identity")
			}
			until(t, ch, func() bool { return a.pl.Radio() != "" })
			_, id, _ := radioParts(a.pl.Radio())
			if id != "recommendations" {
				t.Fatal("home did not attach continuous recommendation playback")
			}

			modes := fixture.Pages["listening-modes"]
			a.browses = map[string]*browseData{"listening-modes": {page: modes}}
			a.route = route{page: pageBrowse, src: "fake", id: "listening-modes"}
			tt.Frame()
			settled(tt)
			saveFrame(t, framesDir(t), fmt.Sprintf("modes-%s-%d.png", theme, width), tt.Image())
			var scene music.Station
			for _, station := range modes.Sections[0].Stations {
				if strings.HasPrefix(station.ID, "scene:") {
					scene = station
					break
				}
			}
			if scene.ID == "" {
				t.Fatal("fixture has no scenario mode")
			}
			if err := tt.Click(scene.Name); err != nil {
				t.Fatal("scenario mode is not reachable")
			}
			if id := wait(t, asked, "scenario station"); id != scene.ID {
				t.Fatal("mode started the wrong feed")
			}
			until(t, ch, func() bool { _, id, _ := radioParts(a.pl.Radio()); return id == scene.ID })
		}
	}
	// Prove the native feature opens the actual recommendation songs.
	a := qishuiSceneApp(t, fixture)
	a.home = fixture.Pages["home"]
	a.route = route{page: pageHome, src: "fake"}
	// The sidebar uses the same words; locate the feature without that duplicate label.
	fake(a).info.Navigation = []music.NavItem{{Title: "首页", Builtin: "home"}}
	tt := ui.NewTester(a.view, 1200, 1000)
	settled(tt)
	if err := tt.Click(a.home.Sections[0].Title); err != nil {
		t.Fatal(err)
	}
	if a.route.page != pageSection {
		t.Fatalf("recommendation feature did not open its songs: %+v", a.route)
	}
}

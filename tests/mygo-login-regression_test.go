package plugin

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"mygo-music/internal/music"
)

// The shipped entry must resolve SignIn through real host.spawn/readLine on moejs.
// The Node child simulates the SDK protocol; this is not a live-account acceptance test.
func TestQishuiLoginRegression(t *testing.T) {
	source, err := os.ReadFile(os.Getenv("QISHUI_PLUGIN_SOURCE"))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := os.ReadFile(filepath.Join(filepath.Dir(os.Getenv("QISHUI_PLUGIN_SOURCE")), "plugin.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"success", "api-error-7", "invalid-account", "verification-prompt"} {
		t.Run(scenario, func(t *testing.T) {
			dir, data := write(t, string(manifest), string(source))
			if err := os.MkdirAll(filepath.Join(dir, "helper"), 0700); err != nil {
				t.Fatal(err)
			}
			child := fmt.Sprintf(`
const rl = require('node:readline').createInterface({input:process.stdin});
const scenario = %q;
const {Features}=require(%q);
const service=new Features({account:async()=>({id:'user-42'}),api:async(path,q,b)=>{
 const track={id:'t1',name:'SDK track',duration:123000};
 if(path.endsWith('/search/track'))return {result_groups:[{id:'tracks',data:[{entity:{track}}],has_more:false}]};
 if(path.endsWith('/track_v2'))return {lyric:{content:'[00:01.00]Test'}};
 if(path.endsWith('/comments'))return {comments:[{id:'c1',content:'Test',time_created:2}],count:'1',has_more:false};
 if(path.endsWith('/discover'))return {blocks:[]};
 if(path.endsWith('/me/playlist'))return {playlist:{id:'created'}};
 if(path.endsWith('/append'))return {};
 throw new Error('Unexpected fixture route');
}});
const emit = value => process.stdout.write(JSON.stringify(value)+'\n');
rl.on('line',async line=>{
 const r=JSON.parse(line); const answer=result=>emit({id:r.id,ok:true,result});
 if(r.op==='hello')return answer({protocol:1,version:'0.2.0'});
 if(r.op==='signIn'){
  emit({id:r.id,event:'prompt',stage:'waiting-scan',text:'Scan',qr:'https://bff-pc.qishui.com/light/invoke/scan_login?token=test-token'});
  if(scenario==='api-error-7')return emit({id:r.id,ok:false,error:{code:'api',message:'rejected (7)',apiCode:7}});
  if(scenario==='verification-prompt')emit({id:r.id,event:'prompt',stage:'verification',text:'Complete the official verification'});
  return answer({cookie:'sessionid=runtime-session',account:scenario==='invalid-account'?{}:{id:'user-42',name:'Test listener'}});
 }
 if(r.op==='catalog')return answer(await service.dispatch(r.params));
 if(r.op==='stream'){
  const dataDir=process.argv[process.argv.indexOf('--data-dir')+1];
  const type=r.params.quality==='lossless'?'flac':'mp3';
  const url=require('node:url').pathToFileURL(dataDir+'/audio-cache/run-test/0123456789abcdef0123456789abcdef.'+type).href;
  return answer({url,type,quality:r.params.quality,size:4096});
 }
 return answer(null);
});
rl.on('close',()=>process.exit(0));
`, scenario, filepath.Join(filepath.Dir(os.Getenv("QISHUI_PLUGIN_SOURCE")), "helper", "features.cjs"))
			if err := os.WriteFile(filepath.Join(dir, "helper", "launch.cjs"), []byte(child), 0600); err != nil {
				t.Fatal(err)
			}
			p, err := Load(dir, data)
			if err != nil {
				t.Fatal(err)
			}

			if p.Info().Version != "0.4.0" {
				t.Fatal("wrong plugin version")
			}
			routes := map[string]bool{}
			for _, nav := range p.Info().Navigation {
				if nav.Page != "" {
					routes[nav.Page] = true
				} else {
					routes[nav.Builtin] = true
				}
			}
			for _, route := range []string{"home", "liked", "discover", "charts", "history", "stations", "savedAlbums"} {
				if !routes[route] {
					t.Fatalf("missing navigation %s", route)
				}
			}
			t.Cleanup(p.Close)
			p.Grant(true)
			var mu sync.Mutex
			prompts := 0
			p.OnSignInPrompt(func(music.SignInPrompt) { mu.Lock(); prompts++; mu.Unlock() })
			type result struct {
				id  string
				err error
			}
			finished := make(chan result, 1)
			go func() {
				account, err := p.SignIn()
				id := ""
				if account != nil {
					id = account.ID
				}
				finished <- result{id, err}
			}()
			select {
			case got := <-finished:
				if scenario == "api-error-7" || scenario == "invalid-account" {
					if got.err == nil {
						t.Fatal("reported success without a verified SDK account")
					}
					if scenario == "api-error-7" && !strings.Contains(got.err.Error(), "7") {
						t.Fatal(got.err)
					}
				} else {
					if got.err != nil || got.id != "user-42" {
						t.Fatalf("login: %+v", got)
					}
					account, err := p.Account()
					if err != nil || account == nil || account.ID != got.id {
						t.Fatalf("cached account: %+v, %v", account, err)
					}
					found, err := p.Search("test", music.SearchTracks, 0)
					if err != nil || len(found.Tracks) != 1 || found.Tracks[0].ID != "t1" {
						t.Fatalf("SDK catalog: %+v, %v", found, err)
					}

					for _, name := range []string{"home", "browse", "search", "playlists", "playlist", "liked", "isLiked", "savedAlbums", "recent", "stations", "stationNext", "lyrics", "comments", "postComment", "like", "savePlaylist", "saveAlbum", "createPlaylist", "addToPlaylist", "played"} {
						if !p.Can(name) {
							t.Fatalf("missing export %s", name)
						}
					}
					for _, name := range []string{"album", "artist", "suggest", "followArtist", "deletePlaylist", "renamePlaylist", "removeFromPlaylist", "movePlaylistTrack", "likeComment", "shows", "remotePlay"} {
						if p.Can(name) {
							t.Fatalf("blocked export %s", name)
						}
					}
					lyric, err := p.Lyrics("t1")
					if err != nil || lyric.LRC != "[00:01.00]Test" {
						t.Fatalf("lyrics: %+v %v", lyric, err)
					}
					comments, err := p.Comments("t1", 0)
					if err != nil || comments.Comments[0].Time != 2000 {
						t.Fatalf("comments: %+v %v", comments, err)
					}
					created, err := p.CreatePlaylist("New")
					if err != nil || !created.Mine || created.ID != "created" {
						t.Fatalf("create: %+v %v", created, err)
					}
					if err := p.AddToPlaylist("created", []string{"t1", "t2"}); err != nil {
						t.Fatal(err)
					}
					if _, err := p.Browse("discover"); err != nil {
						t.Fatal(err)
					}
					flac, err := p.Stream("t1", "lossless")
					if err != nil || flac.Type != "flac" || flac.Quality != "lossless" || !strings.HasSuffix(flac.URL, ".flac") {
						t.Fatalf("FLAC: %+v %v", flac, err)
					}
					stream, err := p.Stream("t1", "standard")
					if err != nil || stream == nil || stream.Type != "mp3" || stream.Size != 4096 {
						t.Fatalf("SDK audio stream: %+v, %v", stream, err)
					}
				}
			case <-time.After(10 * time.Second):
				t.Fatal("SDK bridge did not settle its SignIn promise")
			}
			mu.Lock()
			defer mu.Unlock()
			if prompts == 0 {
				t.Fatal("helper progress never reached MyGo")
			}
		})
	}
}

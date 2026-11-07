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
	for _, scenario := range []string{"success", "api-error-7", "invalid-account", "verification-prompt"} {
		t.Run(scenario, func(t *testing.T) {
			dir, data := write(t, `{"id":"qishui","main":"index.js","permissions":{"process":["node","/opt/homebrew/bin/node","/usr/local/bin/node"]}}`, string(source))
			if err := os.MkdirAll(filepath.Join(dir, "helper"), 0700); err != nil {
				t.Fatal(err)
			}
			child := fmt.Sprintf(`
const rl = require('node:readline').createInterface({input:process.stdin});
const scenario = %q;
const emit = value => process.stdout.write(JSON.stringify(value)+'\n');
rl.on('line',line=>{
 const r=JSON.parse(line); const answer=result=>emit({id:r.id,ok:true,result});
 if(r.op==='hello')return answer({protocol:1,version:'0.2.0'});
 if(r.op==='signIn'){
  emit({id:r.id,event:'prompt',stage:'waiting-scan',text:'Scan',qr:'https://bff-pc.qishui.com/light/invoke/scan_login?token=test-token'});
  if(scenario==='api-error-7')return emit({id:r.id,ok:false,error:{code:'api',message:'rejected (7)',apiCode:7}});
  if(scenario==='verification-prompt')emit({id:r.id,event:'prompt',stage:'verification',text:'Complete the official verification'});
  return answer({cookie:'sessionid=runtime-session',account:scenario==='invalid-account'?{}:{id:'user-42',name:'Test listener'}});
 }
 if(r.op==='request')return answer({data:{tracks:[{id:'t1',name:'SDK track'}]}});
 return answer(null);
});
rl.on('close',()=>process.exit(0));
`, scenario)
			if err := os.WriteFile(filepath.Join(dir, "helper", "launch.cjs"), []byte(child), 0600); err != nil {
				t.Fatal(err)
			}
			p, err := Load(dir, data)
			if err != nil {
				t.Fatal(err)
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

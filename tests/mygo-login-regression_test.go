package plugin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// The complete shipped module must resolve MyGo's SignIn on its real moejs/fetch runtime.
func TestQishuiLoginRegression(t *testing.T) {
	source, err := os.ReadFile(os.Getenv("QISHUI_PLUGIN_SOURCE"))
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"body-cookie", "header-cookie", "redirect-cookie", "api-error-7", "security-2046", "missing-session"} {
		t.Run(scenario, func(t *testing.T) {
			var mu sync.Mutex
			var calls []string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				calls = append(calls, r.URL.Path)
				mu.Unlock()
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/passport/web/get_qrcode/":
					http.SetCookie(w, &http.Cookie{Name: "passport_csrf_token", Value: "runtime-csrf", Domain: "qishui.com", Path: "/", Secure: true})
					fmt.Fprint(w, `{"message":"success","data":{"error_code":0,"token":"runtime-token","qrcode_index_url":"https://bff-pc.qishui.com/ucenter_web/app/sdk-next?token=runtime-token"}}`)
				case "/passport/web/check_qrconnect/":
					if got := r.Header.Get("Cookie"); got != "passport_csrf_token=runtime-csrf" {
						t.Errorf("missing CSRF cookie: %q", got)
					}
					if got := r.Header.Get("X-Tt-Passport-Csrf-Token"); got != "runtime-csrf" {
						t.Errorf("missing CSRF header: %q", got)
					}
					if r.URL.Query().Get("passport_jssdk_version") != "2.4.13" || r.URL.Query().Get("is_from_ttaccountsdk") != "1" {
						t.Error("missing passport parameters")
					}
					if err := r.ParseForm(); err != nil {
						t.Error(err)
					}
					if r.PostForm.Get("token") != "runtime-token" {
						t.Error("wrong polling token")
					}
					if scenario == "api-error-7" {
						fmt.Fprint(w, `{"message":"error","data":{"error_code":7}}`)
					} else if scenario == "security-2046" {
						fmt.Fprint(w, `{"message":"error","data":{"error_code":2046}}`)
					} else if scenario == "missing-session" {
						fmt.Fprint(w, `{"message":"success","data":{"error_code":0,"status":"confirmed"}}`)
					} else if scenario == "redirect-cookie" {
						fmt.Fprint(w, `{"message":"success","data":{"error_code":0,"status":"confirmed","redirect_url":"https://api.qishui.com/finish"}}`)
					} else if scenario == "header-cookie" {
						http.SetCookie(w, &http.Cookie{Name: "sessionid", Value: "runtime-session", Domain: "qishui.com", Path: "/", Secure: true})
						fmt.Fprint(w, `{"message":"success","data":{"error_code":0,"status":"confirmed"}}`)
					} else {
						fmt.Fprint(w, `{"message":"success","data":{"error_code":0,"status":"confirmed","session_cookie":"sessionid=runtime-session"}}`)
					}
				case "/finish":
					if !strings.Contains(r.Header.Get("Cookie"), "passport_csrf_token=runtime-csrf") {
						t.Error("redirect lost CSRF cookie")
					}
					http.SetCookie(w, &http.Cookie{Name: "sessionid", Value: "runtime-session", Domain: "qishui.com", Path: "/", Secure: true})
					w.Header().Set("Location", "https://api.qishui.com/done")
					w.WriteHeader(302)
				case "/done":
					if !strings.Contains(r.Header.Get("Cookie"), "sessionid=runtime-session") {
						t.Error("redirect lost session cookie")
					}
					fmt.Fprint(w, "ok")
				default:
					t.Errorf("unexpected request: %s", r.URL.Path)
					http.Error(w, "unexpected", 500)
				}
			}))
			defer srv.Close()
			prelude := fmt.Sprintf(`
const realFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(String(input));
  return realFetch(%q + url.pathname + url.search, options);
};
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => realSetTimeout(fn, ms === 2000 ? 1 : ms);
`, srv.URL)
			p := load(t, `{"id":"qishui","main":"index.js","permissions":{"network":["127.0.0.1"]}}`, prelude+string(source))
			// v0.1.7 deliberately provides no host.t.
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
				if scenario == "api-error-7" || scenario == "security-2046" || scenario == "missing-session" {
					if got.err == nil {
						t.Fatal("login reported success without a valid session")
					}
					if scenario == "api-error-7" && !strings.Contains(got.err.Error(), "7") {
						t.Fatal(got.err)
					}
					if scenario == "security-2046" && !strings.Contains(got.err.Error(), "2046") {
						t.Fatal(got.err)
					}
				} else {
					if got.err != nil || got.id == "" {
						t.Fatalf("login did not return an account: %+v", got)
					}
					account, err := p.Account()
					if err != nil || account == nil || account.ID != got.id {
						t.Fatalf("saved account: %+v, %v", account, err)
					}
				}
			case <-time.After(10 * time.Second):
				t.Fatal("SignIn promise never resolved")
			}
			mu.Lock()
			defer mu.Unlock()
			encoded, _ := json.Marshal(calls)
			t.Logf("requests: %s", encoded)
		})
	}
}

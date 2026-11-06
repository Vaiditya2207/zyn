# Preconnect hovered links from HTTPS pages

Enable `network.predictor.enable-hover-on-ssl` in the personal defaults. Most
of the reported workload uses HTTPS pages, and the supplied usage report records
76.21% link transitions. Those transitions do not prove mouse hovering or measure
latency, but make the existing intent-driven fast path a better fit than a
hardcoded list of origins, a history scan or larger speculative socket limits.

## Source evidence

References are relative to the inspected Firefox 159.0.1 engine under
`/Users/vaiditya/dev/personal/zyn/engine`; no engine files are changed.

- `modules/libpref/init/StaticPrefList.yaml:15280` defines this pref as false,
  with `mirror: always`. A dynamic personal default can enable the existing
  consumer without changing its static declaration or compiling native code.
- `docshell/base/nsDocShell.cpp:12565`, `OnOverLink`, returns early for editable
  content. At line 12587, HTTP documents can preconnect, while HTTPS documents
  require this pref. At line 12594 it creates a destination principal retaining
  the content's origin attributes and calls `SpeculativeConnect` at line 12597.
  The legacy "predictor" name is still consumed; this does not enable a separate
  history-learning predictor.
- `netwerk/base/nsIOService.cpp:2247` rejects non-HTTP(S) schemes;
  `IOServiceProxyCallback::OnProxyAvailable` at line 2194 skips non-direct
  proxies. HTTPS-only/HTTPS-first upgrades remain on this path at line 2295.
- `netwerk/protocol/http/nsHttpHandler.cpp:2501` retains origin attributes;
  line 2521 updates network partitioning, and line 2569 retains private-browsing
  state in the connection info. Private mode is not exempt from speculation.
- `netwerk/protocol/http/nsHttpConnectionMgr.cpp:3808` uses the existing
  speculative parallel limit, checks idle connections and active limits.
  `modules/libpref/init/all.js:1221` supplies the unchanged limit of 20.

This can overlap DNS/connection/TLS setup with the time before a click. It does
not fetch a document, send its cookies, guarantee a new connection, or accelerate
keyboard navigation that never triggers the over-link path. Reuse and timing
benefits remain unmeasured. This applies generically to links, not only the
reported GitHub, Argo, GCP and YouTube hosts.

HTTP/3, DNS prefetch, Early Hints and server-directed preconnect are already
enabled in this source. They retain their defaults. DNS cache lifetime/capacity,
DoH, proxy configuration and connection limits also retain their defaults;
`network.http.http2.coalesce-hostnames=false` remains the VPN workaround. No
startup origin warming, traffic logging or new timer is introduced.

## Verification and limitations

`python3 tests/zyn/check-prefs.py`: passed the actual generated preference
assertion and unchanged static output check. `node --test tests/zyn/*.test.mjs`:
34 passed. `git diff --check`: passed. No new runtime JS/C++ logic is introduced.

Rebuild cost: **build:ui**, after the normal preference generation/import; YAML
alone does not update a packaged browser. No browser build/import, profile
migration, site request or live browser test is performed. Profile user values
can still override this unlocked default.

Risk: hovering can reveal a destination to DNS/network servers and spend sockets
or TLS work even without clicking, including in private windows. The existing
proxy/local-address safeguards and limits still apply, but do not imply zero
network cost or a universal VPN speed improvement. Restore this pref to false
to roll back. Sign-ins and normal page loads use their existing request paths.

Later, use a disposable profile and local test fixtures to compare HTTPS hover
with this pref false/true, checking `speculative-connect-request` observations,
the absence of a document request until click, private/container separation,
proxy behavior, connection reuse and normal localhost/VPN navigation. Run
`./mach mochitest docshell/test/browser/browser_overlink.js` (status-link
regression coverage, not a complete hover preconnect test) and
`./mach xpcshell-test netwerk/test/unit/test_speculative_connect.js` after a
candidate build. Also smoke sign-ins, Vimium, Zen Home/floating URL bar,
WhatsApp, video/PiP and glass appearance. Release readiness is runtime-unverified;
Temporal is not involved.

# DB4 Dynamic Island Music — Unreal Engine module

An isolated Apple Dynamic Island inspired music/playlist overlay for the AstonDB4 native Unreal game. Uses **YouTube's official IFrame Player API** and the `WebBrowserWidget` Unreal plugin.

## Install

1. Copy `Plugins/DB4MusicIsland` into `AstonDB4_Unreal_Environment/Plugins/`.
2. Enable `DB4MusicIsland` in the project's `.uproject` `Plugins` list (its descriptor enables Epic's `WebBrowserWidget`).
3. Add `PublicDependencyModuleNames.Add("DB4MusicIsland");` to `Source/AstonDB4/AstonDB4.Build.cs`.
4. In `Source/AstonDB4/DB4GameMode.cpp` include `DB4MusicIslandLibrary.h` and call `UDB4MusicIslandLibrary::ShowMusicIsland(GetWorld()->GetFirstPlayerController(), TEXT("http://127.0.0.1:8766/"));` at the end of `StartPlay()` after `Super::StartPlay()`.
5. Run `python3 run_music_server.py` from this folder, or double-click `run_music_server.command` on macOS (if macOS allows executing scripts).
6. Check `http://127.0.0.1:8766/` in Chrome before running Unreal. Then build the game and press Play.

See `INTEGRATION.cpp.txt` for copy-paste code.

## Features

- Glowing, spring-like Apple Dynamic Island-inspired now-playing pill.
- YouTube video URLs, share links, Shorts links and YouTube playlist URLs.
- Queue (up to 150 entries), play/pause, next, previous, shuffle, repeat and per-player volume.
- Official, **visible** YouTube player with original controls/ads intact (video box always greater than 200×200).
- Title and thumbnail from YouTube embedded player; browser localStorage persists queue.
- Responsive high-quality dark glass in-game radio UI.
- UE C++ blueprint callable show/hide interface. Hiding pauses/unloads player to prevent hidden YouTube playback.

## Integration details

The *YouTube player must remain visible while playing*. Do not collapse the WebBrowser into a hidden player, cover its embedded controls, or extract its audio. Compact 'island' now-playing information is above a permanently visible video area. YouTube may reject embed-blocked videos (101/150). Playback error 153 generally means the required HTTP Referer was omitted; always load the page over HTTP(S), not `file://`.

Unreal's `WebBrowserWidget` is a built-in plugin, but embedded Chromium and codec support can vary by UE version and operating system. On macOS, test in-editor and packaged builds; if an asset plays in Chrome but not in Unreal, the plugin browser may lack the requisite media support. `run_music_server.py` is development-only. For a distributable game, host `Resources/Web` on an HTTPS URL you control (or implement a supported app-identified webview hosting flow); then call `ShowMusicIsland(PlayerController, TEXT("https://your-domain.example/db4/"))`.

Input note: browser focus can intercept WASD driving keys when active. Clicking back into the game (outside this widget) restores driving focus. Position is top-right, 486x750 px, configured in `DB4MusicIslandWidget.cpp`.

## Validation performed

JS parse check, JSON parse checks, local HTTP service and static asset checks. Unreal editor build, embedded CEF YouTube playback, audio, and packaged macOS runtime **not tested**.

## Docs

- <https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/WebBrowserWidget/UWebBrowser>
- <https://developers.google.com/youtube/iframe_api_reference>
- <https://developers.google.com/youtube/terms/required-minimum-functionality>

# bridle-helper

The Apple frameworks Electron can't reach, as one long-lived process the main process talks to over
JSON lines (protocol at the top of `Sources/bridle-helper/main.swift`; client in `src/main/native/helper.ts`).

| Command | Framework | Used by |
|---|---|---|
| `embed` | NaturalLanguage `NLContextualEmbedding` (English, mean-pooled, 512-d unit vectors) | Search, Settings → Embeddings "On-device" |
| `ocr` | Vision `VNRecognizeTextRequest` (accurate, language correction) | Index: png jpg heic tiff gif bmp webp |
| `transcribe` | Speech `SpeechAnalyzer` + `SpeechTranscriber` (`DictationTranscriber` where unavailable) | Index: m4a mp3 wav aiff caf aac flac mov mp4 m4v |
| `thumbnail` | `QLThumbnailGenerator` | Files rows + inspector, file viewer ("other" kinds) |
| `dictate` | `AVAudioEngine` → `SpeechAnalyzer` (volatile + final results) | Chat composer mic |

```sh
npm run build:native   # swift build -c release → .build/release/bridle-helper and bridle-notch
```

## bridle-notch

A second, AppKit process (`Sources/bridle-notch/main.swift`; client `src/main/notch.ts`): a black island around
the camera housing listing chats and Code workspaces whose agent is working (spinner) or waiting on you (orange
dot), plus "New in Home". Hover opens the list, a row opens that chat or workspace. It never takes focus. On a
screen without a notch it hangs from the top of the menu bar, centered. Not built: no notch, nothing else changes.

Not built? The app still runs: search is words only, images/audio aren't indexed (retried once it's built),
Files shows kind icons, and the mic says how to build it. Requires macOS 26 and Xcode 26+.

Models: macOS downloads them on first use. The embedding assets via `requestAssets()` (until they arrive,
search stays words-only; it asks again every 5 minutes) and the speech model via `AssetInventory`.

## Permissions

- Microphone (dictation only). The helper asks with `AVCaptureDevice.requestAccess`; macOS attributes the
  prompt to the responsible app: in `npm run dev` that's Electron (its stock Info.plist has
  `NSMicrophoneUsageDescription`) or the terminal you launched it from. Denied → the mic shows
  "Microphone access is off…"; reset with `tccutil reset Microphone com.github.Electron`.
  If the responsible app lacks the usage string, macOS kills the helper; the app survives and the composer
  says dictation stopped.
- Speech recognition: on-device `SpeechAnalyzer` transcribed a file without any prompt here, so no
  `SFSpeechRecognizer.requestAuthorization`. Ship `NSSpeechRecognitionUsageDescription` anyway.

## Packaging (no electron-builder config exists yet)

```yaml
extraResources:
  - from: native/BridleHelper/.build/release/bridle-helper
    to: bridle-helper            # found at process.resourcesPath/bridle-helper
  - from: native/BridleHelper/.build/release/bridle-notch
    to: bridle-notch
mac:
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist   # com.apple.security.device.audio-input = true
  extendInfo:
    NSMicrophoneUsageDescription: Bridle listens while you dictate a message.
    NSSpeechRecognitionUsageDescription: Bridle turns your speech into text on this Mac.
```

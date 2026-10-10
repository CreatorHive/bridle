// bridle-helper: Apple's on-device frameworks for the Electron app, which can't reach them itself.
//
// One long-lived process; JSON lines both ways. Each request runs concurrently:
//   → {"id":1,"cmd":"embed","texts":["…"]}          ← {"id":1,"ok":{"dimension":512,"vectors":[[…]]}}
//   → {"id":2,"cmd":"ocr","path":"/a.png"}           ← {"id":2,"ok":{"text":"…"}}
//   → {"id":3,"cmd":"thumbnail","path":"/a.pdf","size":256}  ← {"id":3,"ok":{"png":"<base64>"}}
//   → {"id":4,"cmd":"transcribe","path":"/a.m4a"}    ← {"id":4,"ok":{"text":"…"}}
//   → {"id":5,"cmd":"dictate","action":"start"|"stop"|"cancel"}  ← {"id":5,"ok":{}}
//       while dictating: {"event":"dictation","text":"…","final":false|true}, or {"event":"dictation","error":"…"}
//   → {"id":6,"cmd":"ping"}                          ← {"id":6,"ok":{"version":1}}
// A failure answers {"id":…,"error":"message"}. EOF on stdin (the app quit) exits.

import Accelerate
import AVFoundation
import Foundation
import ImageIO
import NaturalLanguage
import QuickLookThumbnailing
import Speech
import UniformTypeIdentifiers
import Vision

struct Failure: Error, LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

// MARK: - Output

private let outLock = NSLock()

func send(_ object: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: object) else { return }
    data.append(0x0A)
    outLock.lock()
    FileHandle.standardOutput.write(data)
    outLock.unlock()
}

// MARK: - Embeddings

/// Apple's on-device contextual model, mean-pooled to a unit vector.
/// The model's assets are downloaded by macOS on first use (`requestAssets`); until they arrive, embed fails.
actor Embedder {
    static let shared = Embedder()
    private var model: NLContextualEmbedding?

    private func loaded() async throws -> NLContextualEmbedding {
        if let model { return model }
        guard let m = NLContextualEmbedding(language: .english) else { throw Failure("No English contextual embedding on this Mac") }
        if !m.hasAvailableAssets {
            let result = try await m.requestAssets()
            guard result == .available else {
                throw Failure("The on-device embedding model isn't downloaded yet; macOS is fetching it, try again later")
            }
        }
        try m.load()
        model = m
        return m
    }

    func embed(_ texts: [String]) async throws -> [String: Any] {
        let m = try await loaded()
        let zero = [Float](repeating: 0, count: m.dimension)
        return ["dimension": m.dimension, "vectors": texts.map { vector(m, $0) ?? zero }]
    }

    private func vector(_ model: NLContextualEmbedding, _ text: String) -> [Float]? {
        let text = String(text.prefix(1200)) // the model reads 256 tokens at most
        guard let result = try? model.embeddingResult(for: text, language: .english) else { return nil }
        var sum = [Double](repeating: 0, count: model.dimension)
        var count = 0.0
        result.enumerateTokenVectors(in: text.startIndex..<text.endIndex) { v, _ in
            if v.count == sum.count { sum = vDSP.add(sum, v); count += 1 }
            return true
        }
        guard count > 0 else { return nil }
        let mean = sum.map { Float($0 / count) }
        let norm = sqrt(vDSP.sumOfSquares(mean))
        return norm > 0 ? vDSP.divide(mean, norm) : nil
    }
}

// MARK: - OCR (PLAN.md: images → Vision)

func ocr(_ path: String) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    try VNImageRequestHandler(url: URL(fileURLWithPath: path)).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

// MARK: - Thumbnails

/// A Quick Look thumbnail `size` points square at 2x, as PNG. Fails for files with no real thumbnail (only an icon).
func thumbnail(_ path: String, size: Double) async throws -> String {
    let request = QLThumbnailGenerator.Request(fileAt: URL(fileURLWithPath: path), size: CGSize(width: size, height: size),
                                               scale: 2, representationTypes: .thumbnail)
    let image = try await QLThumbnailGenerator.shared.generateBestRepresentation(for: request).cgImage
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { throw Failure("PNG encoder") }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { throw Failure("PNG encoder") }
    return (data as Data).base64EncodedString()
}

// MARK: - Speech (PLAN.md: audio → SpeechAnalyzer; Voice: dictation)

typealias Piece = (text: String, final: Bool)

/// One SpeechAnalyzer module for the user's locale, with its results as plain text pieces: SpeechTranscriber,
/// or DictationTranscriber where SpeechTranscriber isn't available on this hardware. Downloads the locale's
/// model first if macOS doesn't have it yet.
func transcriber(live: Bool) async throws -> (module: any SpeechModule, results: AsyncThrowingStream<Piece, Error>) {
    if SpeechTranscriber.isAvailable, let locale = await SpeechTranscriber.supportedLocale(equivalentTo: .current) {
        let t = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: live ? [.volatileResults] : [], attributeOptions: [])
        try await install([t])
        return (t, pieces(t.results) { (String($0.text.characters), $0.isFinal) })
    }
    guard let locale = await DictationTranscriber.supportedLocale(equivalentTo: .current) else {
        throw Failure("Speech recognition doesn't support \(Locale.current.identifier) on this Mac")
    }
    let d = DictationTranscriber(locale: locale, preset: live ? .progressiveShortDictation : .longDictation)
    try await install([d])
    return (d, pieces(d.results) { (String($0.text.characters), $0.isFinal) })
}

func install(_ modules: [any SpeechModule]) async throws {
    if let request = try await AssetInventory.assetInstallationRequest(supporting: modules) {
        try await request.downloadAndInstall()
    }
}

func pieces<S: AsyncSequence>(_ results: S, _ map: @escaping (S.Element) -> Piece) -> AsyncThrowingStream<Piece, Error> {
    AsyncThrowingStream { c in
        let task = Task {
            do {
                for try await r in results { c.yield(map(r)) }
                c.finish()
            } catch {
                c.finish(throwing: error)
            }
        }
        c.onTermination = { _ in task.cancel() }
    }
}

/// An audio file's words. AVAudioFile reads what Core Audio reads (m4a, mp3, wav, aiff, caf, and most movie audio).
func transcribe(_ path: String) async throws -> String {
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    let (module, results) = try await transcriber(live: false)
    let analyzer = try await SpeechAnalyzer(inputAudioFile: file, modules: [module], finishAfterFile: true)
    var text: [String] = []
    for try await piece in results where piece.final {
        let t = piece.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty { text.append(t) }
    }
    _ = analyzer
    return text.joined(separator: " ")
}

/// Live microphone dictation: an AVAudioEngine tap, converted to the analyzer's format, streaming
/// volatile (partial) and final text as "dictation" events. Stop finalizes what's left; cancel drops it.
actor Dictation {
    static let shared = Dictation()
    private var engine: AVAudioEngine?
    private var input: AsyncStream<AnalyzerInput>.Continuation?
    private var analyzer: SpeechAnalyzer?
    private var reader: Task<Void, Never>?

    func start() async throws {
        guard engine == nil else { return }
        try await microphone()
        let (module, results) = try await transcriber(live: true)
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) else {
            throw Failure("Speech recognition has no audio format for this Mac")
        }
        let engine = AVAudioEngine()
        let node = engine.inputNode
        let micFormat = node.outputFormat(forBus: 0)
        guard micFormat.sampleRate > 0, micFormat.channelCount > 0 else { throw Failure("No microphone found") }
        guard let converter = AVAudioConverter(from: micFormat, to: format) else { throw Failure("Can't convert microphone audio") }

        let analyzer = SpeechAnalyzer(modules: [module])
        try await analyzer.prepareToAnalyze(in: format)
        let (stream, input) = AsyncStream<AnalyzerInput>.makeStream()
        node.installTap(onBus: 0, bufferSize: 4096, format: micFormat) { buffer, _ in
            if let converted = convert(buffer, converter, format) { input.yield(AnalyzerInput(buffer: converted)) }
        }
        try await analyzer.start(inputSequence: stream)
        engine.prepare()
        do {
            try engine.start()
        } catch {
            node.removeTap(onBus: 0)
            await analyzer.cancelAndFinishNow()
            throw Failure("Can't start the microphone: \(error.localizedDescription)")
        }
        reader = Task {
            do {
                for try await piece in results { send(["event": "dictation", "text": piece.text, "final": piece.final]) }
            } catch {
                send(["event": "dictation", "error": error.localizedDescription])
            }
        }
        (self.engine, self.input, self.analyzer) = (engine, input, analyzer)
    }

    func stop(cancel: Bool) async {
        guard let engine else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        input?.finish()
        if cancel { await analyzer?.cancelAndFinishNow() } else { try? await analyzer?.finalizeAndFinishThroughEndOfInput() }
        if cancel { reader?.cancel() }
        await reader?.value
        (self.engine, self.input, self.analyzer, self.reader) = (nil, nil, nil, nil)
    }

    /// Asks once (macOS shows its prompt for the responsible app: Bridle, or Electron in development).
    private func microphone() async throws {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return
        case .notDetermined: if await AVCaptureDevice.requestAccess(for: .audio) { return }
        default: break
        }
        throw Failure("Microphone access is off. Turn it on in System Settings → Privacy & Security → Microphone")
    }
}

func convert(_ buffer: AVAudioPCMBuffer, _ converter: AVAudioConverter, _ format: AVAudioFormat) -> AVAudioPCMBuffer? {
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate) + 1
    guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
    var given = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
        if given {
            status.pointee = .noDataNow
            return nil
        }
        given = true
        status.pointee = .haveData
        return buffer
    }
    return error == nil && out.frameLength > 0 ? out : nil
}

// MARK: - Requests

func handle(_ request: [String: Any]) async throws -> Any {
    func string(_ key: String) throws -> String {
        guard let s = request[key] as? String, !s.isEmpty else { throw Failure("missing \(key)") }
        return s
    }
    switch request["cmd"] as? String {
    case "ping":
        return ["version": 1]
    case "embed":
        guard let texts = request["texts"] as? [String] else { throw Failure("missing texts") }
        return try await Embedder.shared.embed(texts)
    case "ocr":
        return ["text": try ocr(try string("path"))]
    case "thumbnail":
        return ["png": try await thumbnail(try string("path"), size: (request["size"] as? Double) ?? 256)]
    case "transcribe":
        return ["text": try await transcribe(try string("path"))]
    case "dictate":
        switch try string("action") {
        case "start": try await Dictation.shared.start()
        case "stop": await Dictation.shared.stop(cancel: false)
        case "cancel": await Dictation.shared.stop(cancel: true)
        case let a: throw Failure("unknown dictate action \(a)")
        }
        return [String: Any]()
    case let cmd:
        throw Failure("unknown command \(cmd ?? "nil")")
    }
}

for try await line in FileHandle.standardInput.bytes.lines {
    guard let data = line.data(using: .utf8),
          let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let id = request["id"] else {
        send(["error": "bad request line"])
        continue
    }
    Task {
        do {
            send(["id": id, "ok": try await handle(request)])
        } catch {
            send(["id": id, "error": error.localizedDescription])
        }
    }
}
exit(0)

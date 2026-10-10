// bridle-notch: a black island around the MacBook camera housing that shows what Bridle's agents are doing.
// Electron can't place a window over the menu bar or read the notch's size, so this small AppKit process does it.
//
// JSON lines both ways (client: src/main/notch.ts). Each scene replaces the last:
//   → {"id":1,"cmd":"scene","items":[{"key":"chat:…","title":"Run a command?","detail":"npm test","waiting":true}],"pulse":3}
//   ← {"id":1,"ok":{}}
//   ← {"event":"open","key":"chat:…"}   a row was clicked
// No items: hidden. Items: a strip around the notch (spinner or orange dot, and a count); hovering it opens the
// list. The panel never takes focus. EOF on stdin (the app quit) exits.

import AppKit
import SwiftUI

struct Item: Decodable, Identifiable, Equatable {
    let key: String
    let title: String
    let detail: String?
    let waiting: Bool
    var id: String { key }
}

struct Command: Decodable {
    let id: Int?
    let items: [Item]?
    let pulse: Int?
}

func send(_ object: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: object) else { return }
    data.append(0x0A)
    FileHandle.standardOutput.write(data)
}

// MARK: - Model

@MainActor @Observable final class Island {
    static let side: CGFloat = 44       // how far the strip reaches past each side of the notch
    static let width: CGFloat = 420     // the open list
    static let row: CGFloat = 48
    static let maxRows = 6

    var items: [Item] = []
    var expanded = false
    var bump = false
    /// The physical notch; width 0 on a screen without one (the strip then hangs from the menu bar).
    var notch = CGSize(width: 0, height: 24)

    var compact: CGSize { CGSize(width: notch.width + Self.side * 2, height: notch.height) }
    var open: CGSize {
        CGSize(width: max(Self.width, compact.width),
               height: notch.height + 8 + CGFloat(min(items.count, Self.maxRows)) * Self.row + 10)
    }
    var size: CGSize { items.isEmpty ? .zero : expanded ? open : compact }
    var waiting: Bool { items.contains(where: \.waiting) }
}

// MARK: - View

struct IslandView: View {
    let island: Island

    var body: some View {
        let size = island.size
        let radius: CGFloat = island.expanded ? 22 : 10
        VStack(spacing: 0) {
            HStack {
                Indicator(waiting: island.waiting)
                Spacer(minLength: island.notch.width)
                Text("\(island.items.count)")
                    .font(.system(size: 12, weight: .semibold).monospacedDigit())
                    .foregroundStyle(island.waiting ? .orange : .white)
            }
            .padding(.horizontal, 14)
            .frame(width: island.compact.width, height: island.notch.height)

            if island.expanded {
                VStack(spacing: 0) {
                    ForEach(island.items.prefix(Island.maxRows)) { item in Row(item: item) }
                }
                .padding(.horizontal, 8)
                .padding(.top, 8)
                .transition(.opacity)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .top)
        .clipped()
        .background(.black, in: UnevenRoundedRectangle(bottomLeadingRadius: radius, bottomTrailingRadius: radius))
        .scaleEffect(island.bump ? 1.08 : 1, anchor: .top)
        .opacity(island.items.isEmpty ? 0 : 1)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(.spring(duration: 0.35, bounce: 0.25), value: island.expanded)
        .animation(.spring(duration: 0.3, bounce: 0.5), value: island.bump)
        .animation(.easeOut(duration: 0.2), value: island.items)
        .environment(\.colorScheme, .dark)
    }
}

struct Indicator: View {
    let waiting: Bool
    var body: some View {
        if waiting {
            Circle().fill(.orange).frame(width: 8, height: 8)
        } else {
            ProgressView().controlSize(.mini)
        }
    }
}

struct Row: View {
    let item: Item
    @State private var hover = false

    var body: some View {
        Button { send(["event": "open", "key": item.key]) } label: {
            HStack(spacing: 10) {
                Indicator(waiting: item.waiting).frame(width: 16)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    if let detail = item.detail, !detail.isEmpty {
                        Text(detail).font(.system(size: 12)).foregroundStyle(.white.opacity(0.6))
                    }
                }
                .lineLimit(1)
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.forward").font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(hover ? 0.9 : 0.4))
            }
            .padding(.horizontal, 10)
            .frame(height: Island.row)
            .background(.white.opacity(hover ? 0.1 : 0), in: RoundedRectangle(cornerRadius: 12))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// MARK: - Window

/// Borderless panels refuse key by default; the rows only need clicks, so it never becomes key or main.
final class Panel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor final class Controller {
    let island = Island()
    let panel: Panel
    private var closeAt: Date?
    private var lastPulse: Int?

    init() {
        let frame = CGRect(x: 0, y: 0, width: 640, height: 400) // never resizes; the island animates inside it
        panel = Panel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.ignoresMouseEvents = true
        let host = NSHostingView(rootView: IslandView(island: island))
        host.frame = frame
        panel.contentView = host
        layout()
        panel.orderFrontRegardless()
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.layout() }
        }
        // ponytail: a 20 Hz cursor poll; the collapsed panel is click-through, so it gets
        // no hover events of its own. A global mouse monitor would need no polling but misses our own windows.
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.track() }
        }
    }

    /// The built-in display when it has a notch, else the main one.
    private var screen: NSScreen? { NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main }

    private func layout() {
        guard let s = screen else { return }
        if s.safeAreaInsets.top > 0, let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea {
            island.notch = CGSize(width: s.frame.width - l.width - r.width, height: s.safeAreaInsets.top)
        } else {
            island.notch = CGSize(width: 0, height: NSStatusBar.system.thickness)
        }
        let size = panel.frame.size
        panel.setFrameOrigin(CGPoint(x: s.frame.midX - size.width / 2, y: s.frame.maxY - size.height))
    }

    func apply(_ c: Command) {
        island.items = c.items ?? []
        if island.items.isEmpty { setExpanded(false) }
        if let p = c.pulse, let last = lastPulse, p != last, !island.expanded {
            island.bump = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { self.island.bump = false }
        }
        lastPulse = c.pulse
    }

    /// The island's rectangle in screen coordinates (top-centered on the panel).
    private func rect(_ size: CGSize) -> CGRect {
        let f = panel.frame
        return CGRect(x: f.midX - size.width / 2, y: f.maxY - size.height, width: size.width, height: size.height)
    }

    private func track() {
        guard !island.items.isEmpty else { return }
        let mouse = NSEvent.mouseLocation
        if !island.expanded {
            if rect(island.compact).insetBy(dx: 0, dy: -2).contains(mouse) { setExpanded(true) }
        } else if rect(island.open).insetBy(dx: -12, dy: -12).contains(mouse) {
            closeAt = nil
        } else if let t = closeAt {
            if Date() >= t { setExpanded(false) }
        } else {
            closeAt = Date().addingTimeInterval(0.3)
        }
    }

    private func setExpanded(_ on: Bool) {
        closeAt = nil
        guard island.expanded != on else { return }
        island.expanded = on
        panel.ignoresMouseEvents = !on
        if on { NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now) }
    }
}

// MARK: - Main

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = MainActor.assumeIsolated { Controller() }

Thread.detachNewThread {
    while let line = readLine() {
        guard let c = try? JSONDecoder().decode(Command.self, from: Data(line.utf8)) else { continue }
        DispatchQueue.main.async {
            MainActor.assumeIsolated { controller.apply(c) }
            if let id = c.id { send(["id": id, "ok": [String: Any]()]) }
        }
    }
    exit(0)
}

app.run()

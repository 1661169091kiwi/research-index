import Foundation
import UIKit
import Photos
import Security
import Capacitor

/// Network requests and API keys for the paper feed, and the share card (the iOS twin of RiNative.java).
///
/// request: an HTTP request made natively (no CORS), whose reply streams back to the page as "http" events:
/// head (status, headers), data (text chunks), end, or error. A header value containing "@native:<provider>"
/// gets that provider's API key swapped in, but only when the request goes to the host the key was saved
/// for, so the key itself never enters the page. Keys live in the iOS Keychain (this device only).
///
/// shareImage / saveImage: a paper's share card (a PNG) to the share sheet, or into Photos; fetchImage: a
/// paper's figure for that card; openUrl: a web page in Safari.
@objc(RiNative)
public class RiNative: CAPPlugin, CAPBridgedPlugin, URLSessionDataDelegate {
    public let identifier = "RiNative"
    public let jsName = "RiNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeyHost", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keyInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openUrl", returnType: CAPPluginReturnPromise),
    ]

    // ---------- requests ----------
    private final class Stream {
        let rid: Int
        let figure: Bool
        var pending = [UInt8]()   // bytes of a character cut in two by a chunk boundary
        var seen = ""             // the page so far, while looking for its first figure
        var finished = false
        init(rid: Int, figure: Bool) { self.rid = rid; self.figure = figure }
    }
    private let queue: OperationQueue = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1
        return q
    }()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpMaximumConnectionsPerHost = 6
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()
    private var streams = [Int: Stream]()            // task id -> stream (touched on `queue` only)
    private var tasks = [Int: URLSessionDataTask]()  // rid -> task
    private let lock = NSLock()
    private static let figureRe = try! NSRegularExpression(pattern: "<figure[^>]*>[\\s\\S]*?<img[^>]*src=\"(?!data:)[^\"]+\"[\\s\\S]*?</figure>")
    private static let maxFigureScan = 3_000_000

    private func emit(_ rid: Int, _ type: String, _ extra: [String: Any] = [:]) {
        var ev = extra
        ev["rid"] = rid
        ev["type"] = type
        DispatchQueue.main.async { self.notifyListeners("http", data: ev) }
    }

    @objc func request(_ call: CAPPluginCall) {
        let rid = call.getInt("rid") ?? 0
        let urlString = call.getString("url") ?? ""
        let method = call.getString("method") ?? "GET"
        let body = call.getString("body")
        let until = call.getString("until") ?? ""
        let timeout = Double(call.getInt("timeout") ?? 60000) / 1000
        let headers = call.getObject("headers") ?? [:]
        call.resolve()
        guard let url = URL(string: urlString), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
            emit(rid, "error", ["message": "unsupported URL"])
            return
        }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = method
        var hasUA = false
        do {
            for (name, raw) in headers {
                var value = (raw as? String) ?? "\(raw)"
                if value.contains("@native:") { value = try withKey(value, host: url.host ?? "") }
                if name.lowercased() == "user-agent" { hasUA = true }
                req.setValue(value, forHTTPHeaderField: name)
            }
        } catch {
            emit(rid, "error", ["message": error.localizedDescription])
            return
        }
        if !hasUA { req.setValue("ResearchIndex/1.8 (personal paper reader; iOS)", forHTTPHeaderField: "User-Agent") }
        if let body = body { req.httpBody = body.data(using: .utf8) }
        let task = session.dataTask(with: req)
        let stream = Stream(rid: rid, figure: until == "figure")
        queue.addOperation {
            self.streams[task.taskIdentifier] = stream
            self.lock.lock(); self.tasks[rid] = task; self.lock.unlock()
            task.resume()
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let rid = call.getInt("rid") ?? 0
        queue.addOperation {
            self.lock.lock(); let task = self.tasks.removeValue(forKey: rid); self.lock.unlock()
            if let task = task {
                self.streams[task.taskIdentifier]?.finished = true
                task.cancel()
            }
        }
        call.resolve()
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let s = streams[dataTask.taskIdentifier], !s.finished else { completionHandler(.cancel); return }
        let http = response as? HTTPURLResponse
        var hs = [String: String]()
        for (k, v) in http?.allHeaderFields ?? [:] { hs["\(k)".lowercased()] = "\(v)" }
        emit(s.rid, "head", ["status": http?.statusCode ?? 200, "headers": hs])
        completionHandler(.allow)
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let s = streams[dataTask.taskIdentifier], !s.finished else { return }
        s.pending.append(contentsOf: data)
        let text = RiNative.takeText(&s.pending)
        if text.isEmpty { return }
        emit(s.rid, "data", ["text": text])
        if s.figure {
            s.seen += text
            let found = text.contains("</figure>") && RiNative.figureRe.firstMatch(in: s.seen, range: NSRange(s.seen.startIndex..., in: s.seen)) != nil
            if found || s.seen.utf8.count > RiNative.maxFigureScan {
                // enough of this page: stop reading it
                s.finished = true
                emit(s.rid, "end")
                dataTask.cancel()
            }
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let s = streams.removeValue(forKey: task.taskIdentifier) else { return }
        lock.lock(); tasks.removeValue(forKey: s.rid); lock.unlock()
        if s.finished { return }
        if let error = error {
            emit(s.rid, "error", ["message": error.localizedDescription])
            return
        }
        if !s.pending.isEmpty { emit(s.rid, "data", ["text": String(decoding: s.pending, as: UTF8.self)]) }
        emit(s.rid, "end")
    }

    /// The text in `bytes` up to the last whole UTF-8 character; a character cut by the chunk boundary waits
    /// for the next chunk.
    private static func takeText(_ bytes: inout [UInt8]) -> String {
        var end = bytes.count
        var i = end - 1, cont = 0
        while i >= 0 && cont < 3 && (bytes[i] & 0xC0) == 0x80 { i -= 1; cont += 1 }
        if i >= 0 {
            let lead = bytes[i]
            let need = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1
            if need > cont + 1 { end = i }
        }
        let text = String(decoding: bytes[0..<end], as: UTF8.self)
        bytes.removeFirst(end)
        return text
    }

    // ---------- API keys (Keychain; the saved host and the last four characters in UserDefaults) ----------
    private let service = "io.researchindex.app.keys"
    private let defaults = UserDefaults.standard

    private func keychainGet(_ account: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    private func keychainDelete(_ account: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
    }
    private func keychainSet(_ account: String, _ value: String) -> Bool {
        keychainDelete(account)
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
                                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, kSecValueData as String: Data(value.utf8)]
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    private struct KeyError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }
    /// Swaps "@native:<provider>" for that provider's key, if the request goes to the key's own host.
    private func withKey(_ value: String, host: String) throws -> String {
        guard let r = value.range(of: "@native:[a-z]+", options: .regularExpression) else { return value }
        let provider = String(value[r].dropFirst("@native:".count))
        let allowed = defaults.string(forKey: "ri.\(provider).host") ?? ""
        guard let key = keychainGet("\(provider).key"), !allowed.isEmpty, allowed.caseInsensitiveCompare(host) == .orderedSame else {
            throw KeyError(message: "API key is not available for \(host)")
        }
        return value.replacingCharacters(in: r, with: key)
    }

    @objc func setKey(_ call: CAPPluginCall) {
        let provider = call.getString("provider") ?? "deepseek"
        let key = (call.getString("key") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let host = call.getString("host") ?? ""
        if key.isEmpty {
            keychainDelete("\(provider).key")
            defaults.removeObject(forKey: "ri.\(provider).hint")
            defaults.removeObject(forKey: "ri.\(provider).host")
            call.resolve()
            return
        }
        guard keychainSet("\(provider).key", key) else { call.reject("Could not store the key"); return }
        defaults.set(String(key.suffix(4)), forKey: "ri.\(provider).hint")
        defaults.set(host, forKey: "ri.\(provider).host")
        call.resolve()
    }

    @objc func setKeyHost(_ call: CAPPluginCall) {
        let provider = call.getString("provider") ?? "deepseek"
        if keychainGet("\(provider).key") != nil { defaults.set(call.getString("host") ?? "", forKey: "ri.\(provider).host") }
        call.resolve()
    }

    @objc func keyInfo(_ call: CAPPluginCall) {
        var out = [String: Any]()
        for p in call.getArray("providers", String.self) ?? [] {
            out[p] = ["has": keychainGet("\(p).key") != nil, "hint": defaults.string(forKey: "ri.\(p).hint") ?? ""]
        }
        call.resolve(out)
    }

    // ---------- sharing a paper as an image ----------
    private static func png(_ call: CAPPluginCall) -> Data? {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else { return nil }
        let sig: [UInt8] = [0x89, 0x50, 0x4E, 0x47]
        return data.count > 8 && data.count < 30_000_000 && Array(data.prefix(4)) == sig ? data : nil
    }
    private static func pngName(_ name: String?) -> String {
        var n = (name ?? "").replacingOccurrences(of: "[^A-Za-z0-9._-]+", with: "-", options: .regularExpression)
        if n.isEmpty || n.count > 80 { n = "paper" }
        return n.hasSuffix(".png") ? n : n + ".png"
    }

    @objc func shareImage(_ call: CAPPluginCall) {
        guard let data = RiNative.png(call) else { call.reject("not a PNG"); return }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appendingPathComponent(RiNative.pngName(call.getString("name")))
            try data.write(to: file)
            let text = call.getString("text") ?? ""
            DispatchQueue.main.async {
                guard let vc = self.bridge?.viewController else { call.reject("no view"); return }
                var items: [Any] = [file]
                if !text.isEmpty { items.append(text) }
                let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
                if let pop = sheet.popoverPresentationController { // iPad: anchored to the middle of the screen
                    pop.sourceView = vc.view
                    pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
                    pop.permittedArrowDirections = []
                }
                vc.present(sheet, animated: true)
                call.resolve()
            }
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func saveImage(_ call: CAPPluginCall) {
        guard let data = RiNative.png(call) else { call.reject("not a PNG"); return }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else { call.reject("denied"); return }
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }) { ok, error in
                if ok { call.resolve(["where": "Photos"]) } else { call.reject(error?.localizedDescription ?? "not saved") }
            }
        }
    }

    // a paper's figure, for its share card (the page could not draw one from another site and export it)
    @objc func fetchImage(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), s.hasPrefix("https://"), let url = URL(string: s) else { call.reject("only https"); return }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.setValue("research-index-app", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: req) { data, response, error in
            let http = response as? HTTPURLResponse
            let type = http?.value(forHTTPHeaderField: "Content-Type") ?? ""
            guard error == nil, let data = data, let code = http?.statusCode, code / 100 == 2, type.hasPrefix("image/"), data.count <= 15_000_000 else {
                call.reject("not an image")
                return
            }
            call.resolve(["data": data.base64EncodedString(), "type": type])
        }.resume()
    }

    // ---------- a web page in Safari (only https) ----------
    @objc func openUrl(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), s.hasPrefix("https://"), let url = URL(string: s) else { call.reject("only https"); return }
        DispatchQueue.main.async {
            UIApplication.shared.open(url) { ok in ok ? call.resolve() : call.reject("could not open") }
        }
    }
}

/// The app's web view, with RiNative registered (a plugin that lives in the app itself, not in a package).
class RiBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RiNative())
    }
}

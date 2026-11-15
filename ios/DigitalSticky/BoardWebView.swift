import Combine
import SwiftUI
import WebKit

/// The board itself: the same web app the wall and browsers show, from the board's server.
/// It signs in with the board's cookie, kept like Safari keeps it. Links to other sites
/// open in Safari.
struct BoardWebView: UIViewRepresentable {
    let base: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(base: base, model: AppModel.shared)
    }

    func makeUIView(context: Context) -> WKWebView {
        let coordinator = context.coordinator
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // The board tells it's in the app by this, as well as `window.stickyApp`.
        configuration.applicationNameForUserAgent = "Mobile/15E148 DigitalStickyApp/\(Coordinator.version)"
        configuration.userContentController.add(WeakMessageHandler(coordinator), name: Coordinator.handlerName)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0xF0 / 255, green: 0xF0 / 255, blue: 0xED / 255, alpha: 1)
        // The page keeps clear of the notch and the home bar itself.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        coordinator.attach(webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.handlerName)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        static let handlerName = "stickyApp"
        static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"

        private let base: URL
        private let model: AppModel
        private weak var webView: WKWebView?
        private var watching = Set<AnyCancellable>()
        private var loaded = false

        init(base: URL, model: AppModel) {
            self.base = base
            self.model = model
        }

        func attach(_ webView: WKWebView) {
            self.webView = webView
            tellPage()
            // The board, at the place waiting to be opened: a sign-in link, or a sticky from a notification.
            let first = model.route
            webView.load(URLRequest(url: BoardAddress.page(base, route: first)))
            if first != nil { DispatchQueue.main.async { [model] in model.route = nil } }

            // A sticky to open later, from a notification.
            model.$route.dropFirst().compactMap { $0 }.receive(on: RunLoop.main).sink { [weak self] route in
                // Moving to another board: the new board's view opens it.
                guard let self, self.model.address == self.base else { return }
                self.model.route = nil
                self.open(route)
            }.store(in: &watching)
            model.reload.sink { [weak self] in self?.reload() }.store(in: &watching)
            // What the board's Notifications section shows about this phone.
            model.$notifications.combineLatest(model.$scheduled).dropFirst().receive(on: RunLoop.main).sink { [weak self] _ in
                self?.tellPage()
            }.store(in: &watching)
        }

        private func open(_ route: String) {
            guard let webView else { return }
            if loaded, let url = webView.url, BoardAddress.sameBoard(url, base) {
                webView.evaluateJavaScript("location.hash = \(Self.json(route))")
            } else {
                webView.load(URLRequest(url: BoardAddress.page(base, route: route)))
            }
        }

        private func reload() {
            guard let webView else { return }
            model.loadError = nil
            if let url = webView.url, BoardAddress.sameBoard(url, base) { webView.reload() } else { webView.load(URLRequest(url: BoardAddress.page(base))) }
        }

        /// `window.stickyApp`: set before the page starts, and updated while it's open.
        private func tellPage() {
            guard let webView else { return }
            let state: [String: Any] = [
                "version": Self.version,
                "notifications": model.notifications.rawValue,
                "address": base.absoluteString,
                "scheduled": model.scheduled,
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: state), let json = String(data: data, encoding: .utf8) else { return }
            let script = "window.stickyApp = \(json); window.dispatchEvent(new Event('sticky-app'));"
            let controller = webView.configuration.userContentController
            controller.removeAllUserScripts()
            controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            if loaded { webView.evaluateJavaScript(script) }
        }

        private static func json(_ text: String) -> String {
            guard let data = try? JSONSerialization.data(withJSONObject: [text]), let array = String(data: data, encoding: .utf8) else { return "''" }
            return String(array.dropFirst().dropLast())
        }

        // MARK: Messages from the page

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "boardChanged":
                Task { await Reminders.shared.refresh() }
            case "enableNotifications":
                Task { await model.enableNotifications() }
            case "testNotification":
                Reminders.shared.test()
            case "openPhoneSettings":
                model.openPhoneSettings()
            case "changeAddress":
                model.showingAddress = true
            default:
                break
            }
        }

        // MARK: Loading

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .cancel }
            let scheme = url.scheme?.lowercased() ?? ""
            if scheme == "about" || scheme == "blob" || scheme == "data" { return .allow }
            let mainFrame = action.targetFrame?.isMainFrame ?? true
            if mainFrame, !BoardAddress.sameBoard(url, base) {
                // Another site, or mail and phone links: Safari and the other apps open them.
                _ = await UIApplication.shared.open(url)
                return .cancel
            }
            return .allow
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loaded = true
            model.loadError = nil
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        private func failed(_ error: Error) {
            let error = error as NSError
            // Another load took its place: not a problem.
            if error.domain == NSURLErrorDomain, error.code == NSURLErrorCancelled { return }
            if error.domain == "WebKitErrorDomain", error.code == 102 { return } // handed to another app
            loaded = false
            model.loadError = error.localizedDescription
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        // MARK: Windows and dialogs

        /// Links that open a new window go to Safari.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
            _ = await ask(message, from: webView, actions: [("OK", .default, true)])
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
            await ask(message, from: webView, actions: [("Cancel", .cancel, false), ("OK", .default, true)]) ?? false
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo) async -> String? {
            var field: UITextField?
            let ok = await ask(prompt, from: webView, actions: [("Cancel", .cancel, false), ("OK", .default, true)]) { alert in
                alert.addTextField { $0.text = defaultText }
                field = alert.textFields?.first
            }
            return ok == true ? field?.text ?? "" : nil
        }

        /// Shows the page's alert, and waits for a button (nil when it can't be shown).
        private func ask(
            _ message: String,
            from view: UIView,
            actions: [(String, UIAlertAction.Style, Bool)],
            setUp: (UIAlertController) -> Void = { _ in }
        ) async -> Bool? {
            var top = view.window?.rootViewController
            while let shown = top?.presentedViewController { top = shown }
            guard let top else { return nil }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            setUp(alert)
            return await withCheckedContinuation { (done: CheckedContinuation<Bool?, Never>) in
                for (title, style, value) in actions {
                    alert.addAction(UIAlertAction(title: title, style: style) { _ in done.resume(returning: value) })
                }
                top.present(alert, animated: true)
            }
        }
    }
}

/// Lets the page's messages reach the coordinator without the web view keeping it alive.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

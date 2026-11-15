import Foundation

/// The board's address, from what was typed or scanned off the wall.
struct BoardAddress: Equatable {
    /// The board itself, like `http://10.0.0.182:3000` or `https://souren.tail1234.ts.net`.
    let base: URL
    /// The sign-in code in the wall's QR code (`…/#pair-K7QM2XPA`), if there was one.
    let pairCode: String?

    /// The board's own port, when an address is typed without one.
    static let defaultPort = 3000

    /// Reads "10.0.0.182:3000", "souren.local", "sticky.example.com", "https://souren.tail1234.ts.net",
    /// or the link in the wall's code. Nil when it isn't an address.
    init?(_ text: String) {
        var text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !text.contains(" ") else { return nil }
        let typedScheme = text.contains("://")
        if !typedScheme {
            // Names on the internet (a domain, a Tailscale name) are https; the home network is plain http.
            text = (Self.onHomeNetwork(text) ? "http://" : "https://") + text
        }
        guard var parts = URLComponents(string: text),
              let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = parts.host, !host.isEmpty
        else { return nil }
        if !typedScheme, scheme == "http", parts.port == nil { parts.port = Self.defaultPort }
        let fragment = parts.fragment ?? ""
        pairCode = fragment.hasPrefix("pair-") && fragment.count > 5 ? String(fragment.dropFirst(5)) : nil
        parts.scheme = scheme
        parts.host = host.lowercased()
        parts.fragment = nil
        parts.query = nil
        // The board can be served from a sub-path; keep it, without the slash at the end.
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        guard let url = parts.url else { return nil }
        base = url
    }

    /// "10.0.0.182", "souren.local:3000", "nuc": an address only the home network knows.
    private static func onHomeNetwork(_ typed: String) -> Bool {
        let host = typed.lowercased().split(separator: "/").first.map(String.init) ?? ""
        let name = host.hasPrefix("[") ? host : String(host.split(separator: ":").first ?? "")
        if name.hasPrefix("[") || name.allSatisfy({ $0.isNumber || $0 == "." }) { return true } // an IP address
        if !name.contains(".") { return true }
        return [".local", ".lan", ".home", ".internal", ".home.arpa", ".localdomain"].contains { name.hasSuffix($0) }
    }

    /// The page to open: the board, at `route` (like "#note-abc") if given.
    static func page(_ base: URL, route: String? = nil) -> URL {
        URL(string: base.absoluteString + "/" + (route ?? "")) ?? base
    }

    /// An address on the board's server, like "api/upcoming".
    static func api(_ base: URL, _ path: String) -> URL {
        URL(string: base.absoluteString + "/" + path) ?? base
    }

    /// Same scheme, host and port: a page of the board, not some other site.
    static func sameBoard(_ url: URL, _ base: URL) -> Bool {
        url.scheme?.lowercased() == base.scheme?.lowercased()
            && url.host?.lowercased() == base.host?.lowercased()
            && effectivePort(url) == effectivePort(base)
    }

    private static func effectivePort(_ url: URL) -> Int? {
        url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80)
    }

    /// For showing: "10.0.0.182:3000", "souren.tail1234.ts.net".
    static func label(_ base: URL) -> String {
        base.absoluteString.replacingOccurrences(of: "^https?://", with: "", options: .regularExpression)
    }
}

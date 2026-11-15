import BackgroundTasks
import Foundation
import UserNotifications
import WebKit

/// The board's reminders and follow-up nudges, set as notifications on the phone ahead of
/// time (from the board's api/upcoming), so they come on time even with no connection.
/// They're set again whenever the board changes while it's open, when the app opens or
/// goes away, and every so often in the background when iOS lets the app check.
@MainActor
final class Reminders {
    static let shared = Reminders()

    /// Every notification the app sets starts with this, so they can be cleared together.
    nonisolated static let prefix = "sticky."
    /// iOS keeps at most 64 waiting notifications per app.
    private static let limit = 60

    nonisolated static var backgroundTask: String { (Bundle.main.bundleIdentifier ?? "DigitalSticky") + ".refresh" }

    private struct Upcoming: Decodable {
        let notices: [Notice]
    }

    struct Notice: Decodable {
        let title: String
        let body: String
        /// Where a tap opens the board, like "#note-abc".
        let url: String
        let tag: String
        let at: String
    }

    private var busy = false
    private var again = false

    /// Sets the reminders again, from the board. Asks once at a time.
    func refresh() async {
        if busy {
            again = true
            return
        }
        busy = true
        repeat {
            again = false
            await update()
        } while again && !Task.isCancelled
        busy = false
    }

    private func update() async {
        let model = AppModel.shared
        guard let base = model.address else { return }
        await model.refreshNotificationState()
        guard model.notifications == .on, let notices = await fetch(base) else { return }

        let center = UNUserNotificationCenter.current()
        let waiting = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
        center.removePendingNotificationRequests(withIdentifiers: waiting)
        var count = 0
        for notice in notices.prefix(Self.limit) {
            guard let at = Self.date(notice.at), at > Date() else { continue }
            let content = UNMutableNotificationContent()
            content.title = notice.title
            content.body = notice.body
            content.sound = .default
            content.threadIdentifier = "reminders"
            content.userInfo = ["url": notice.url]
            let when = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: at)
            let request = UNNotificationRequest(
                identifier: Self.prefix + notice.tag,
                content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
            )
            if (try? await center.add(request)) != nil { count += 1 }
        }
        model.scheduled = count
    }

    /// The reminders coming up, or nil when the board can't be reached (or this phone isn't signed in).
    private func fetch(_ base: URL) async -> [Notice]? {
        let url = BoardAddress.api(base, "api/upcoming")
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        // The board knows this phone by the cookie it got when it signed in, in the board's web view.
        for (name, value) in HTTPCookie.requestHeaderFields(with: await Self.cookies(for: url)) {
            request.setValue(value, forHTTPHeaderField: name)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }
        guard let (data, response) = try? await session.data(for: request), (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return (try? JSONDecoder().decode(Upcoming.self, from: data))?.notices
    }

    /// The web view's cookies that go with `url`.
    private static func cookies(for url: URL) async -> [HTTPCookie] {
        let all = await withCheckedContinuation { (done: CheckedContinuation<[HTTPCookie], Never>) in
            WKWebsiteDataStore.default().httpCookieStore.getAllCookies { done.resume(returning: $0) }
        }
        let host = url.host?.lowercased() ?? ""
        let https = url.scheme?.lowercased() == "https"
        return all.filter { cookie in
            var domain = cookie.domain.lowercased()
            if domain.hasPrefix(".") { domain.removeFirst() }
            let hostMatches = host == domain || host.hasSuffix("." + domain)
            let fresh = cookie.expiresDate.map { $0 > Date() } ?? true
            return hostMatches && url.path.hasPrefix(cookie.path) && (https || !cookie.isSecure) && fresh
        }
    }

    /// Takes off the reminders this app set (when it's moved to another board).
    func clear() {
        Task {
            let center = UNUserNotificationCenter.current()
            let waiting = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
            center.removePendingNotificationRequests(withIdentifiers: waiting)
        }
    }

    /// A notification right away, to check they show up.
    func test() {
        let content = UNMutableNotificationContent()
        content.title = "Notifications are on"
        content.body = "Reminders from the wall show up like this."
        content.sound = .default
        content.userInfo = ["url": "#board"]
        let request = UNNotificationRequest(identifier: "test", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
        UNUserNotificationCenter.current().add(request)
    }

    /// The board's times: "2026-10-01T18:00:00.000Z".
    nonisolated static func date(_ iso: String) -> Date? {
        let precise = ISO8601DateFormatter()
        precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return precise.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    // MARK: In the background

    /// Lets iOS wake the app now and then to check for new reminders. Called at launch.
    nonisolated static func registerBackgroundRefresh() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: backgroundTask, using: nil) { task in
            scheduleBackgroundRefresh()
            let work = Task { @MainActor in
                await Reminders.shared.refresh()
                task.setTaskCompleted(success: !Task.isCancelled)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    /// Asks for the next check, in half an hour at the soonest (iOS picks the time).
    nonisolated static func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: backgroundTask)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}

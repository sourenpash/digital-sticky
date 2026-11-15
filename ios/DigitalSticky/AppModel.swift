import Combine
import Foundation
import UIKit
import UserNotifications

/// Everything the app keeps track of: which board it opens, and the notifications it sets.
@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    private static let addressKey = "boardAddress"

    /// The board this phone opens (nil until it's set up).
    @Published private(set) var address: URL?
    /// Where the board should go next: a sign-in link (`#pair-…`) or a sticky from a notification.
    @Published var route: String?
    /// The address screen is showing.
    @Published var showingAddress = false
    /// Why the board couldn't be opened, if it couldn't.
    @Published var loadError: String?
    /// Asks the board to load again (after a failed load).
    let reload = PassthroughSubject<Void, Never>()

    /// Whether the phone shows the board's reminders.
    @Published private(set) var notifications: NotificationState = .unknown
    /// How many reminders are set on the phone now.
    @Published var scheduled = 0

    enum NotificationState: String {
        case unknown, on, denied
    }

    private init() {
        if let saved = UserDefaults.standard.string(forKey: Self.addressKey) { address = URL(string: saved) }
    }

    /// Opens `board` from now on (and signs in with its code, if it has one).
    func use(_ board: BoardAddress) {
        if board.base != address {
            UserDefaults.standard.set(board.base.absoluteString, forKey: Self.addressKey)
            scheduled = 0
            Reminders.shared.clear()
        }
        route = board.pairCode.map { "#pair-\($0)" }
        loadError = nil
        address = board.base
        showingAddress = false
    }

    func refreshNotificationState() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: notifications = .on
        case .denied: notifications = .denied
        default: notifications = .unknown
        }
    }

    /// Asks to show notifications (the first time), then sets the reminders.
    func enableNotifications() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        await refreshNotificationState()
        await Reminders.shared.refresh()
    }

    func openPhoneSettings() {
        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
    }
}

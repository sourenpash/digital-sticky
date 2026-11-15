import SwiftUI
import UserNotifications

@main
struct DigitalStickyApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .active:
                Task { await Reminders.shared.refresh() }
            case .background:
                Reminders.scheduleBackgroundRefresh()
                Task { await Reminders.shared.refresh() }
            default:
                break
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Reminders.registerBackgroundRefresh()
        return true
    }

    /// Shows reminders while the app is open too.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    /// A tap opens the sticky.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let route = response.notification.request.content.userInfo["url"] as? String, route.hasPrefix("#") else { return }
        await MainActor.run { AppModel.shared.route = route }
    }
}

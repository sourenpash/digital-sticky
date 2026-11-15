# Sticky for iPhone

The board as an app on your iPhone (and iPad). It opens the same board as the wall and the web pages, from your own wall computer, and adds what an app can do:

- **Scan the wall's code** to set it up. The code holds the board's address and signs the phone in, so there's nothing to type.
- **Reminders as notifications, set ahead of time.** The app sets the board's reminders and follow-up nudges on the phone itself, so they go off on time even with no connection, on the Wi-Fi address too (Web Push needs https and the Home Screen). They're set again whenever the board changes while the app is open, when it opens or goes away, and now and then in the background. A tap opens the sticky.
- Links to other sites open in Safari, and mail and phone links in their apps.

Nothing is kept anywhere but your wall computer and the phone.

## Put it on your iPhone

You need a Mac with Xcode 16 or newer, and the iPhone on iOS 16 or newer.

1. On the Mac, get this repository, then make the Xcode project and open it. In Terminal:
   ```sh
   brew install xcodegen          # once (from https://brew.sh)
   cd digital-sticky/ios
   xcodegen
   open DigitalSticky.xcodeproj
   ```
2. Click the **DigitalSticky** project, then the **DigitalSticky** target, then **Signing & Capabilities**. Under **Team**, pick your Apple ID (Add an Account… if it isn't there). A free Apple ID works.
   - If Xcode says the bundle identifier is taken, change `com.sourenpash.digitalsticky` there to something of your own.
3. Plug the iPhone into the Mac and unlock it. Pick it at the top of the Xcode window, then press **Run** (⌘R).
   - The first time, the iPhone asks you to turn on **Developer Mode** (Settings → Privacy & Security → Developer Mode) and restart.
   - With a free Apple ID, it also needs you to trust yourself: Settings → General → VPN & Device Management → your Apple ID → Trust.
4. In the app: **Scan the wall's code**. Then, in the board, go to Wall → Notifications → **Turn on notifications on this phone**.

**How long it lasts.** With a free Apple ID, apps you install yourself stop opening after 7 days: plug the phone in and press Run again (the board and sign-in stay). With the Apple Developer Program ($99 a year) it lasts a year, and you can send it to other people's phones with TestFlight.

## Using it away from home

The app opens whatever address the wall's code has. At home that's the wall computer's Wi-Fi address (like `http://10.0.0.182:3000`), which only works on your Wi-Fi. To use it anywhere, turn on [From anywhere](../README.md#from-anywhere-optional) on the wall computer (`scripts/linux/anywhere.sh`), then in the app scan the wall's code again: it now holds the board's `https://….ts.net` address, which works at home and away. To change it later: Wall → Notifications → **Change**, or **Change the address** when the board can't be reached.

## Changing the app

The Xcode project is made from `project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen), so it isn't in the repository. After changing `project.yml`, or adding or removing a Swift file, run `xcodegen` in this folder again.

To set your team for good, put it in `project.yml` as `DEVELOPMENT_TEAM` (it's the 10 characters in Xcode's Signing settings) before running `xcodegen`. Otherwise pick it in Xcode again after each `xcodegen`.

The tests (⌘U) check reading addresses and the wall's code.

| File | What it does |
| --- | --- |
| `DigitalStickyApp.swift` | Starts the app; taps on notifications open the sticky |
| `ContentView.swift` | The board, the screen to set its address (scan or type), and what shows when it can't be reached |
| `BoardWebView.swift` | The board's page, and what it asks of the app (`window.webkit.messageHandlers.stickyApp`) |
| `Reminders.swift` | Sets the board's reminders as notifications on the phone, from `GET /api/upcoming` |
| `CodeScanner.swift` | The camera, reading the wall's QR code |
| `BoardAddress.swift` | Reading addresses, as typed or in the wall's code |

The board knows it's in the app by `window.stickyApp`, which the app sets before the page starts (see `web/src/lib/nativeApp.ts`). Its Notifications section then shows the app's switch rather than Web Push.

## The App Store

The app could go on the App Store as a free app for people who run their own board, the way apps for other home servers do:

- It needs the Apple Developer Program ($99 a year), a privacy policy page (the app collects nothing, so it's short), screenshots, and a board Apple's reviewers can reach. Give them a demo board (`npm run demo` behind From anywhere) and say in the review notes that the app is for a board you run at home.
- Apps that only show a website are often turned down (guideline 4.2). This one sets notifications itself and scans the wall's code. Say so in the review notes.
- `ITSAppUsesNonExemptEncryption` is already `false` (the app uses only Apple's https), and `PrivacyInfo.xcprivacy` is already there.

Hosting boards for people who don't have a wall computer would be a different thing. The board server keeps one board for one home, so it would need accounts, a board per account, and a server to run them on. Apple would also require in-app purchase for a subscription sold in the app.

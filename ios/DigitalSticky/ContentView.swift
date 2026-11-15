import SwiftUI

/// The board, once the app knows where it is; until then, the screen to set that up.
struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    /// The board's own background, so there's no white flash while it loads.
    static let paper = Color(red: 0xF0 / 255, green: 0xF0 / 255, blue: 0xED / 255)

    var body: some View {
        if let address = model.address {
            ZStack {
                Self.paper.ignoresSafeArea()
                BoardWebView(base: address)
                    .id(address)
                    .ignoresSafeArea()
                if let error = model.loadError {
                    CantReachView(address: address, error: error)
                }
            }
            .sheet(isPresented: $model.showingAddress) {
                NavigationStack { AddressView(current: address) }
            }
        } else {
            NavigationStack { AddressView(current: nil) }
        }
    }
}

/// When the board doesn't answer: why that might be, and what to do.
struct CantReachView: View {
    let address: URL
    let error: String
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack {
            ContentView.paper.ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 44))
                    .foregroundStyle(.secondary)
                Text("Can’t reach the board")
                    .font(.title2.bold())
                Text("at \(BoardAddress.label(address))")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text(address.scheme == "https"
                    ? "Check the wall computer is on and connected. If From anywhere was turned off, scan the wall’s code again."
                    : "This address only works on your home Wi-Fi. To use the board anywhere, run scripts/linux/anywhere.sh on the wall computer, then scan the wall’s code again.")
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
                Button {
                    model.reload.send()
                } label: {
                    Text("Try again").frame(maxWidth: 260)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(.top, 8)
                Button("Change the address") { model.showingAddress = true }
            }
            .multilineTextAlignment(.center)
            .padding(28)
        }
    }
}

/// Setting the board's address: scanning the wall's code (which also signs this phone in),
/// or typing it.
struct AddressView: View {
    /// The address in use, or nil the first time.
    let current: URL?
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var scanning = false
    @State private var checking = false
    @State private var problem: String?
    /// An address that didn't answer, to use anyway if asked.
    @State private var unanswered: BoardAddress?

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(current == nil ? "Open your board" : "Move to another address")
                        .font(.title3.bold())
                    Text("Scan the code on the wall. It signs this phone in and has the board’s address, so it works at home and, once From anywhere is on, away from home too.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                Button {
                    Task { await startScanning() }
                } label: {
                    Label("Scan the wall’s code", systemImage: "qrcode.viewfinder")
                }
                .disabled(checking)
            }

            Section {
                TextField("10.0.0.182:3000 or name.ts.net", text: $typed)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit { Task { await connect(typed) } }
                Button {
                    Task { await connect(typed) }
                } label: {
                    HStack {
                        Text("Connect")
                        if checking {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty || checking)
            } header: {
                Text("Or type the address")
            } footer: {
                Text("It’s under the wall’s code. On your home Wi-Fi it’s the wall computer’s address and port, like 10.0.0.182:3000. From anywhere, it’s the board’s https address.")
            }

            if let problem {
                Section {
                    Text(problem)
                        .foregroundStyle(.red)
                    if let unanswered {
                        Button("Use \(BoardAddress.label(unanswered.base)) anyway") { model.use(unanswered) }
                    }
                }
            }
        }
        .navigationTitle(current == nil ? "Digital Sticky" : "Board address")
        .navigationBarTitleDisplayMode(current == nil ? .large : .inline)
        .toolbar {
            if current != nil {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .sheet(isPresented: $scanning) {
            NavigationStack {
                CodeScanner { code in
                    scanning = false
                    Task { await connect(code, scanned: true) }
                }
                .ignoresSafeArea()
                .navigationTitle("Scan the wall’s code")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { scanning = false }
                    }
                }
            }
        }
        .onAppear {
            if let current, typed.isEmpty { typed = BoardAddress.label(current) }
        }
    }

    private func startScanning() async {
        if await CameraAccess.request() {
            scanning = true
        } else {
            problem = "The camera is off for this app. Turn it on in Settings, or type the address."
            unanswered = nil
        }
    }

    private func connect(_ text: String, scanned: Bool = false) async {
        problem = nil
        unanswered = nil
        guard let board = BoardAddress(text) else {
            problem = scanned ? "That isn’t the board’s code. Scan the code in the corner of the wall." : "That doesn’t look like an address. Try something like 10.0.0.182:3000."
            return
        }
        checking = true
        let answered = await BoardCheck.answers(board.base)
        checking = false
        if answered {
            model.use(board)
        } else {
            unanswered = board
            problem = "The board didn’t answer at \(BoardAddress.label(board.base)). Check this phone is on the same Wi-Fi as the wall (or that From anywhere is on). If the iPhone asked about finding devices on your local network, allow it, then try again."
        }
    }
}

/// Whether there's a board at an address.
enum BoardCheck {
    static func answers(_ base: URL) async -> Bool {
        let request = URLRequest(url: BoardAddress.api(base, "api/health"), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return false }
        return body["ok"] as? Bool == true
    }
}

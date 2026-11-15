import XCTest
@testable import DigitalSticky

final class BoardAddressTests: XCTestCase {
    func testTypedHomeAddressesGetTheBoardsPort() {
        XCTAssertEqual(BoardAddress("10.0.0.182")?.base.absoluteString, "http://10.0.0.182:3000")
        XCTAssertEqual(BoardAddress(" Souren.local:3000 ")?.base.absoluteString, "http://souren.local:3000")
        XCTAssertEqual(BoardAddress("http://10.0.0.182")?.base.absoluteString, "http://10.0.0.182")
    }

    func testDomainsAreHttps() {
        XCTAssertEqual(BoardAddress("sticky.example.com")?.base.absoluteString, "https://sticky.example.com")
        XCTAssertEqual(BoardAddress("Sticky.Example.com/")?.base.absoluteString, "https://sticky.example.com")
        XCTAssertEqual(BoardAddress("nuc")?.base.absoluteString, "http://nuc:3000")
        XCTAssertEqual(BoardAddress("nuc.lan")?.base.absoluteString, "http://nuc.lan:3000")
    }

    func testTailscaleNamesAreHttps() {
        XCTAssertEqual(BoardAddress("souren.tail1234.ts.net")?.base.absoluteString, "https://souren.tail1234.ts.net")
        XCTAssertEqual(BoardAddress("https://souren.tail1234.ts.net/")?.base.absoluteString, "https://souren.tail1234.ts.net")
    }

    func testTheWallsCodeHasTheAddressAndTheSignInCode() {
        let board = BoardAddress("https://souren.tail1234.ts.net/#pair-K7QM2XPA")
        XCTAssertEqual(board?.base.absoluteString, "https://souren.tail1234.ts.net")
        XCTAssertEqual(board?.pairCode, "K7QM2XPA")
        XCTAssertNil(BoardAddress("http://10.0.0.182:3000/#board")?.pairCode)
    }

    func testKeepsASubPath() {
        XCTAssertEqual(BoardAddress("https://example.ts.net/sticky/")?.base.absoluteString, "https://example.ts.net/sticky")
        XCTAssertEqual(BoardAddress.page(URL(string: "https://example.ts.net/sticky")!, route: "#note-a").absoluteString, "https://example.ts.net/sticky/#note-a")
    }

    func testRejectsWhatIsNotAnAddress() {
        XCTAssertNil(BoardAddress(""))
        XCTAssertNil(BoardAddress("hello there"))
        XCTAssertNil(BoardAddress("ftp://10.0.0.182"))
        XCTAssertNil(BoardAddress("WIFI:S:Home;T:WPA;P:secret;;"))
    }

    func testSameBoard() {
        let base = URL(string: "http://10.0.0.182:3000")!
        XCTAssertTrue(BoardAddress.sameBoard(URL(string: "http://10.0.0.182:3000/#wall")!, base))
        XCTAssertFalse(BoardAddress.sameBoard(URL(string: "http://10.0.0.182:3001/")!, base))
        XCTAssertFalse(BoardAddress.sameBoard(URL(string: "https://example.com/")!, base))
        XCTAssertTrue(BoardAddress.sameBoard(URL(string: "https://a.ts.net:443/x")!, URL(string: "https://a.ts.net")!))
    }

    func testReadsTheBoardsTimes() {
        XCTAssertEqual(Reminders.date("2026-10-01T18:00:00.000Z")?.timeIntervalSince1970, 1_790_877_600)
        XCTAssertEqual(Reminders.date("2026-10-01T18:00:00Z")?.timeIntervalSince1970, 1_790_877_600)
        XCTAssertNil(Reminders.date("tomorrow"))
    }
}

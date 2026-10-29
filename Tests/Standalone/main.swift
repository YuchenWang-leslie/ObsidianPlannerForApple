// Standalone equivalent of the XCTest suite, for Command Line Tools without XCTest.
import Foundation

func XCTAssertTrue(_ value: @autoclosure () -> Bool, file: StaticString = #filePath, line: UInt = #line) {
    precondition(value(), "Expected true at \(file):\(line)")
}
func XCTAssertFalse(_ value: @autoclosure () -> Bool, file: StaticString = #filePath, line: UInt = #line) {
    precondition(!value(), "Expected false at \(file):\(line)")
}
func XCTAssertEqual<T: Equatable>(_ a: T, _ b: T, file: StaticString = #filePath, line: UInt = #line) {
    precondition(a == b, "Expected \(a) == \(b) at \(file):\(line)")
}
func XCTAssertNotEqual<T: Equatable>(_ a: T, _ b: T, file: StaticString = #filePath, line: UInt = #line) {
    precondition(a != b, "Expected distinct values at \(file):\(line)")
}

import Foundation

final class DayPlannerParserTests {
    let zone = TimeZone(identifier: "Asia/Shanghai")!
    func parse(_ text: String, date: String = "2026-10-29") -> ParseResult {
        DayPlannerParser.parse(text: text, date: date, timeZone: zone)
    }

    func testExampleAndCompletedTask() {
        let result = parse("# Day planner\n- [ ] 10:40 - 11:30 Example\n- [X] 12:00 - 13:00 完成")
        XCTAssertEqual(result.entries.count, 2)
        XCTAssertEqual(result.entries[0].end.timeIntervalSince(result.entries[0].start), 3000)
        XCTAssertFalse(result.entries[0].completed)
        XCTAssertTrue(result.entries[1].completed)
        XCTAssertEqual(result.entries[1].title, "完成")
        XCTAssertTrue(result.issues.isEmpty)
    }

    func testOnlyTargetSectionOutsideFencesAndComments() {
        let result = parse("""
        # Other
        - [ ] 08:00 - 09:00 Ignore
        # Day planner
        ```markdown
        - [ ] 09:00 - 10:00 Ignore fence
        <!--
        ```
        <!--
        - [ ] 10:00 - 11:00 Ignore comment
        -->
        - [ ] 11:00 - 12:00 Keep
        ## Details
        - [ ] 12:00 - 13:00 Also keep
        # End
        - [ ] 13:00 - 14:00 Ignore
        """)
        XCTAssertEqual(result.entries.map(\.title), ["Keep", "Also keep"])
    }

    func testUnsupportedAndInvalidEntriesAreReported() {
        let result = parse("""
        # Day planner
        - [ ] 09:00 Only start
        - [ ] No time
          - [ ] 09:00 - 10:00 Nested
        - [-] 09:00 - 10:00 Other status
        - [ ] 24:00 - 25:00 Invalid
        - [ ] 23:00 - 01:00 Overnight
        - [ ] 09:00 - 09:00 Empty duration
        - [ ] 09:00 - 10:00   
        """)
        XCTAssertTrue(result.entries.isEmpty)
        XCTAssertEqual(result.issues.count, 8)
    }

    func testDuplicateSectionsBlockExport() {
        let result = parse("# Day planner\n- [ ] 09:00 - 10:00 A\n# Day planner\n- [ ] 10:00 - 11:00 B")
        XCTAssertTrue(result.entries.isEmpty)
        XCTAssertEqual(result.issues.count, 1)
    }

    func testOverlapPreservesDistinctEntries() {
        let result = parse("# Day planner\n- [ ] 09:00 - 10:00 Same\n- [ ] 09:00 - 10:00 Same")
        XCTAssertEqual(result.entries.count, 2)
        XCTAssertNotEqual(result.entries[0].id, result.entries[1].id)
        XCTAssertEqual(result.issues.count, 1)
    }

    func testDatesAndCustomHeading() {
        XCTAssertTrue(parse("# Day planner\n- [ ] 09:00 - 10:00 Work", date: "2026-02-29").entries.isEmpty)
        XCTAssertEqual(parse("# Day planner\n- [ ] 09:00 - 10:00 Work", date: "2028-02-29").entries.count, 1)
        let result = DayPlannerParser.parse(text: "## Plan\n- [ ] 09:00 - 10:00 Work", date: "2026-10-29", timeZone: zone, heading: "Plan", headingLevel: 2)
        XCTAssertEqual(result.entries.count, 1)
    }

    func testDSTMissingAndRepeatedTimes() {
        let newYork = TimeZone(identifier: "America/New_York")!
        let spring = DayPlannerParser.parse(text: "# Day planner\n- [ ] 02:15 - 03:30 Missing", date: "2026-03-08", timeZone: newYork)
        let fall = DayPlannerParser.parse(text: "# Day planner\n- [ ] 01:15 - 02:30 Repeated", date: "2026-11-01", timeZone: newYork)
        XCTAssertTrue(spring.entries.isEmpty)
        XCTAssertTrue(fall.entries.isEmpty)
        XCTAssertEqual(spring.issues.count, 1)
        XCTAssertEqual(fall.issues.count, 1)
    }

    func testMondayWeeksAcrossYear() {
        let date = PlannerDates.day("2027-01-01", timeZone: zone)!
        let week = PlannerDates.week(containing: date, timeZone: zone)
        XCTAssertEqual(PlannerDates.string(week.start, timeZone: zone), "2026-12-28")
        XCTAssertEqual(PlannerDates.string(week.end, timeZone: zone), "2027-01-03")
        let next = PlannerDates.week(containing: date, offset: 1, timeZone: zone)
        XCTAssertEqual(PlannerDates.string(next.start, timeZone: zone), "2027-01-04")
    }

    func testInclusiveDaysAcrossDST() {
        let newYork = TimeZone(identifier: "America/New_York")!
        let days = PlannerDates.days(from: PlannerDates.day("2026-03-07", timeZone: newYork)!, through: PlannerDates.day("2026-03-09", timeZone: newYork)!, timeZone: newYork)
        XCTAssertEqual(days.map { PlannerDates.string($0, timeZone: newYork) }, ["2026-03-07", "2026-03-08", "2026-03-09"])
        XCTAssertEqual(days[2].timeIntervalSince(days[1]), 23 * 3600)
        XCTAssertTrue(PlannerDates.days(from: days[2], through: days[0], timeZone: newYork).isEmpty)
    }
}

let suite = DayPlannerParserTests()
suite.testExampleAndCompletedTask()
print("PASS testExampleAndCompletedTask")
suite.testOnlyTargetSectionOutsideFencesAndComments()
print("PASS testOnlyTargetSectionOutsideFencesAndComments")
suite.testUnsupportedAndInvalidEntriesAreReported()
print("PASS testUnsupportedAndInvalidEntriesAreReported")
suite.testDuplicateSectionsBlockExport()
print("PASS testDuplicateSectionsBlockExport")
suite.testOverlapPreservesDistinctEntries()
print("PASS testOverlapPreservesDistinctEntries")
suite.testDatesAndCustomHeading()
print("PASS testDatesAndCustomHeading")
suite.testDSTMissingAndRepeatedTimes()
print("PASS testDSTMissingAndRepeatedTimes")
suite.testMondayWeeksAcrossYear()
print("PASS testMondayWeeksAcrossYear")
suite.testInclusiveDaysAcrossDST()
print("PASS testInclusiveDaysAcrossDST")
print("All 9 core tests passed.")

runMatchingTests()

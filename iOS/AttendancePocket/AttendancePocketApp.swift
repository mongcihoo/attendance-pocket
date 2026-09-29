import SwiftUI

@main
struct AttendancePocketApp: App {
    var body: some Scene {
        WindowGroup {
            WebAppView()
                .ignoresSafeArea(.container, edges: .bottom)
        }
    }
}

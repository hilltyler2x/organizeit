import Capacitor
import Foundation
import StoreKit
import UIKit

/// Asks for an App Store review with the system's own sheet, and opens OrganizeIt's App Store
/// page to write one. iOS decides whether the sheet shows (at most 3 times a year, never in
/// TestFlight), so asking is always safe.
@objc(AppReviewPlugin)
public class AppReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppReviewPlugin"
    public let jsName = "AppReview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openStore", returnType: CAPPluginReturnPromise)
    ]

    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let scene = self.bridge?.viewController?.view.window?.windowScene
                ?? UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
                return call.resolve()
            }
            if #available(iOS 16.0, *) {
                AppStore.requestReview(in: scene)
            } else {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve()
        }
    }

    @objc func openStore(_ call: CAPPluginCall) {
        guard let id = call.getString("appStoreId"), !id.isEmpty,
              let url = URL(string: "https://apps.apple.com/app/id\(id)?action=write-review") else {
            return call.reject("The App Store page isn't set up yet.")
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url)
            call.resolve()
        }
    }
}

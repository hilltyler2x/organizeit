import Capacitor
import Foundation

/// Lets the app hand the background sorter its snapshot and collect what was sorted while it
/// was closed. The sorting itself lives in BackgroundSorter.
@objc(BackgroundSortPlugin)
public class BackgroundSortPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackgroundSortPlugin"
    public let jsName = "BackgroundSort"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeResults", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    private let sorter = BackgroundSorter.shared

    @objc func configure(_ call: CAPPluginCall) {
        guard JSONSerialization.isValidJSONObject(call.options as Any),
              let data = try? JSONSerialization.data(withJSONObject: call.options as Any),
              let config = try? JSONDecoder().decode(BackgroundSortConfig.self, from: data) else {
            return call.reject("Invalid background sort settings")
        }
        sorter.store.save(config: config)
        sorter.scheduleBackgroundTasks()
        sorter.queueChanged(waiting: config.queued.count)
        call.resolve()
    }

    @objc func takeResults(_ call: CAPPluginCall) {
        let results = sorter.store.takeResults().map { item -> [String: Any] in
            [
                "asset": item.asset.dictionary,
                "result": [
                    "section": item.result.section,
                    "category": item.result.category,
                    "label": item.result.label,
                    "confidence": item.result.confidence
                ]
            ]
        }
        call.resolve(["results": results])
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(self.sorter.status())
        }
    }
}

import Foundation
import FoundationModels
import FoundationModelsUtilities

@main
struct KeystoneFoundationModels {
    static func main() async {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if arguments == ["--help"] {
            print("Usage: npm run agent:apple -- <on-device|hosted> < prompt.txt")
            return
        }
        guard arguments.count == 1, ["on-device", "hosted"].contains(arguments[0]) else {
            fail("Choose on-device or hosted. Use --help for usage.", code: 2)
        }

        let session: LanguageModelSession
        if arguments[0] == "on-device" {
            let model = SystemLanguageModel.default
            guard model.isAvailable else {
                fail("The on-device model is unavailable. Check Apple Intelligence settings.")
            }
            session = LanguageModelSession(model: model)
        } else {
            let environment = ProcessInfo.processInfo.environment
            guard let modelName = environment["KEYSTONE_APPLE_MODEL"], !modelName.isEmpty,
                  let endpoint = environment["KEYSTONE_APPLE_BASE_URL"],
                  let url = URL(string: endpoint), let host = url.host,
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1"].contains(host))
            else {
                fail("Set KEYSTONE_APPLE_MODEL and a valid KEYSTONE_APPLE_BASE_URL (HTTPS or local HTTP).", code: 2)
            }

            var headers: [String: String] = [:]
            if let apiKey = environment["KEYSTONE_APPLE_API_KEY"], !apiKey.isEmpty {
                headers["Authorization"] = "Bearer \(apiKey)"
            }
            let model = ChatCompletionsLanguageModel(
                name: modelName,
                url: url,
                additionalHeaders: headers,
                supportsGuidedGeneration: false
            )
            session = LanguageModelSession(model: model)
        }

        let input = FileHandle.standardInput.readDataToEndOfFile()
        guard let prompt = String(data: input, encoding: .utf8),
              !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            fail("Provide a nonempty UTF-8 prompt on standard input.", code: 2)
        }

        do {
            let response = try await session.respond(to: prompt)
            print(response.content)
        } catch {
            fail("Generation failed (\(type(of: error))). Check model availability and provider configuration.")
        }
    }

    private static func fail(_ message: String, code: Int32 = 1) -> Never {
        FileHandle.standardError.write(Data("Keystone Foundation Models: \(message)\n".utf8))
        exit(code)
    }
}

import CoreGraphics
import Foundation

let doubleTapInterval = 0.45
let modifierKeyCodes: Set<CGKeyCode> = [54, 55, 56, 57, 58, 59, 60, 61, 62, 63]
var optionWasDown = false
var optionUsedAsChord = false
var lastOptionTapAt: TimeInterval = 0

func writeLine(_ line: String) {
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

func hasNonModifierKeyDown() -> Bool {
    for keyCode in CGKeyCode(0) ... CGKeyCode(127) where !modifierKeyCodes.contains(keyCode) {
        if CGEventSource.keyState(.combinedSessionState, key: keyCode) { return true }
    }
    return false
}

func sampleKeyboardState() {
    let flags = CGEventSource.flagsState(.combinedSessionState)
    let optionIsDown = flags.contains(.maskAlternate)

    if optionIsDown {
        if !optionWasDown {
            let chordFlags: CGEventFlags = [.maskCommand, .maskControl, .maskShift]
            optionUsedAsChord = !flags.intersection(chordFlags).isEmpty
        }
        if !optionUsedAsChord && hasNonModifierKeyDown() { optionUsedAsChord = true }
        optionWasDown = true
        return
    }

    guard optionWasDown else { return }
    optionWasDown = false
    if optionUsedAsChord {
        optionUsedAsChord = false
        lastOptionTapAt = 0
        return
    }

    let tappedAt = ProcessInfo.processInfo.systemUptime
    if lastOptionTapAt > 0 && tappedAt - lastOptionTapAt <= doubleTapInterval {
        lastOptionTapAt = 0
        writeLine("capture")
    } else {
        lastOptionTapAt = tappedAt
    }
}

let monitorQueue = DispatchQueue(label: "com.t3tools.t3code.appshot-shortcut", qos: .userInitiated)
let timer = DispatchSource.makeTimerSource(queue: monitorQueue)
timer.schedule(deadline: .now(), repeating: .milliseconds(8), leeway: .milliseconds(2))
timer.setEventHandler(handler: sampleKeyboardState)
timer.resume()
writeLine("ready")
dispatchMain()

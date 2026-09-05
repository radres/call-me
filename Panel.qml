import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui

Item {
  id: root

  property var shell: null
  property var manifest: null
  property var hostWidget: null
  property var bar: null
  property var anchorItem: null

  property bool opened: false
  property bool paired: false
  property bool busy: false
  property bool pairingMode: false
  property bool confirmClear: false
  property bool testControlsVisible: false
  property bool setupVisible: false
  property bool manageVisible: false
  property string numberDigits: ""
  property string numberDisplay: ""
  property string pairNumberText: ""
  property string statusText: "Checking callme…"
  property string feedback: ""
  property string copyNotice: ""
  property string messageText: ""
  property string actionKind: ""
  property string actionOutput: ""
  property string pendingSelectionText: ""
  property Item navItem: null

  onPairedChanged: if (opened) Qt.callLater(root.ensureNavigation)

  readonly property string configPath: Quickshell.env("HOME") + "/.aiphone/config.json"
  readonly property string apiBase: "https://serdaroztetik.com/aiphone"

  function displayNumber(value) {
    var n = String(value || "").replace(/\D/g, "")
    if (n.length !== 10) return n
    return n.slice(0, 3) + "-" + n.slice(3, 6) + "-" + n.slice(6)
  }

  function open(payloadJson) {
    opened = true
    feedback = ""
    testControlsVisible = false
    setupVisible = false
    manageVisible = false
    navItem = null
    refresh()
    Qt.callLater(function() {
      root.ensureNavigation()
      keyCatcher.forceActiveFocus()
    })
  }

  function close() {
    opened = false
    feedback = ""
    copyNotice = ""
    pairingMode = false
    confirmClear = false
    testControlsVisible = false
    pendingSelectionText = ""
    selectionCopyTimer.stop()
    copyNoticeTimer.stop()
    if (numberProc.running) numberProc.running = false
    if (pairProc.running) pairProc.running = false
    if (clearProc.running) clearProc.running = false
    if (actionProc.running) actionProc.running = false
    busy = false
  }

  function dismiss() {
    if (hostWidget && typeof hostWidget.close === "function") {
      hostWidget.close()
      return
    }
    if (shell && manifest && typeof shell.hide === "function") {
      shell.hide(String(manifest.id))
      return
    }
    close()
  }

  function refresh() {
    paired = false
    numberDigits = ""
    numberDisplay = ""
    statusText = "Checking callme…"
    if (numberProc.running) numberProc.running = false
    numberProc.running = true
  }

  function isNavigationItem(item) {
    return item && item.visible && item.enabled !== false
  }

  function navigationItems() {
    var items = []
    if (!root.paired) {
      if (isNavigationItem(getAppButton)) items.push(getAppButton)
      if (isNavigationItem(pairField)) items.push(pairField)
      if (isNavigationItem(pairButton)) items.push(pairButton)
      if (isNavigationItem(cancelPairButton)) items.push(cancelPairButton)
    } else if (!root.pairingMode) {
      if (isNavigationItem(copyPromptButton)) items.push(copyPromptButton)
      if (isNavigationItem(connectButton)) items.push(connectButton)
      for (var i = 0; i < connectionSections.count; i++) {
        var section = connectionSections.itemAt(i)
        if (!section) continue
        if (isNavigationItem(section.navToggle)) items.push(section.navToggle)
        if (isNavigationItem(section.navCopy)) items.push(section.navCopy)
      }
      if (isNavigationItem(testButton)) items.push(testButton)
      if (isNavigationItem(messageField)) items.push(messageField)
      if (isNavigationItem(textButton)) items.push(textButton)
      if (isNavigationItem(callButton)) items.push(callButton)
      if (isNavigationItem(cancelActionButton)) items.push(cancelActionButton)
      if (isNavigationItem(manageButton)) items.push(manageButton)
      if (isNavigationItem(copyNumberButton)) items.push(copyNumberButton)
      if (isNavigationItem(pairAgainButton)) items.push(pairAgainButton)
      if (isNavigationItem(clearButton)) items.push(clearButton)
      if (isNavigationItem(cancelClearButton)) items.push(cancelClearButton)
    }
    if (isNavigationItem(closeButton)) items.push(closeButton)
    return items
  }

  function setNavigationItem(item) {
    if (!isNavigationItem(item)) return
    navItem = item
  }

  function ensureNavigation() {
    if (!opened) return
    var items = navigationItems()
    if (!items.length) return
    if (items.indexOf(navItem) === -1) setNavigationItem(items[0])
    keyCatcher.forceActiveFocus()
  }

  function moveNavigation(step) {
    var items = navigationItems()
    if (!items.length) return
    var index = items.indexOf(navItem)
    if (index < 0) index = step > 0 ? -1 : 0
    index = (index + step + items.length) % items.length
    setNavigationItem(items[index])
  }

  function expandNavigation() {
    if (navItem === connectButton) {
      setupVisible = true
      Qt.callLater(root.ensureNavigation)
      return
    }
    if (navItem === testButton) {
      testControlsVisible = true
      Qt.callLater(root.ensureNavigation)
      return
    }
    if (navItem === manageButton) {
      manageVisible = true
      confirmClear = false
      Qt.callLater(root.ensureNavigation)
      return
    }
    for (var i = 0; i < connectionSections.count; i++) {
      var section = connectionSections.itemAt(i)
      if (section && navItem === section.navToggle) {
        section.expanded = true
        Qt.callLater(root.ensureNavigation)
        return
      }
    }
  }

  function shrinkNavigation() {
    if (navItem === connectButton) {
      setupVisible = false
      Qt.callLater(root.ensureNavigation)
      return
    }
    if (navItem === testButton) {
      testControlsVisible = false
      Qt.callLater(root.ensureNavigation)
      return
    }
    if (navItem === manageButton) {
      manageVisible = false
      confirmClear = false
      Qt.callLater(root.ensureNavigation)
      return
    }
    for (var i = 0; i < connectionSections.count; i++) {
      var section = connectionSections.itemAt(i)
      if (!section) continue
      if (navItem === section.navToggle) {
        section.expanded = false
        Qt.callLater(root.ensureNavigation)
        return
      }
      if (navItem === section.navCopy || navItem === section.navEditor) {
        section.expanded = false
        setNavigationItem(connectButton)
        Qt.callLater(root.ensureNavigation)
        return
      }
    }
  }

  function activateNavigation() {
    if (!isNavigationItem(navItem)) {
      ensureNavigation()
      return
    }
    if (typeof navItem.clicked === "function") navItem.clicked()
    else navItem.forceActiveFocus()
    if (typeof navItem.clicked === "function") keyCatcher.forceActiveFocus()
    Qt.callLater(root.ensureNavigation)
  }

  function textEditorFocused() {
    if (pairField.activeFocus || messageField.activeFocus) return true
    for (var i = 0; i < connectionSections.count; i++) {
      var section = connectionSections.itemAt(i)
      if (section && section.navEditor && section.navEditor.activeFocus) return true
    }
    return false
  }

  function enterPairingMode() {
    pairingMode = true
    confirmClear = false
    testControlsVisible = false
    pairNumberText = ""
    feedback = "Enter the exact number shown in the iPhone app."
  }

  function pairNumber() {
    var n = pairNumberText.trim().replace(/\D/g, "")
    if (n.length !== 10) {
      feedback = "Enter the exact 10-digit number shown in the callme app."
      return
    }
    if (pairProc.running) return

    feedback = "Saving your paired number locally…"
    busy = true
    pairProc.command = [
      "bash", "-c",
      "set -euo pipefail; "
        + "cfg=\"$HOME/.aiphone/config.json\"; "
        + "mkdir -p \"${cfg%/*}\"; chmod 700 \"${cfg%/*}\"; "
        + "prev='{}'; [[ -f \"$cfg\" ]] && prev=$(cat \"$cfg\"); "
        + "tmp=\"$cfg.tmp.$$\"; "
        + "printf '%s' \"$prev\" | jq --arg n \"$1\" --arg d \"$2\" --arg t \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" "
        + "'. + {version:1, user_number:$n, display:$d, source:\"omarchy-panel\", updated_at:$t} | del(.api)' "
        + "> \"$tmp\"; mv \"$tmp\" \"$cfg\"; chmod 600 \"$cfg\"",
      "omarchy-call-me", n, displayNumber(n)
    ]
    pairProc.running = true
  }

  function clearPairing() {
    if (clearProc.running) return

    feedback = "Clearing the saved number locally…"
    busy = true
    clearProc.command = [
      "bash", "-c",
      "set -euo pipefail; "
        + "cfg=\"$HOME/.aiphone/config.json\"; "
        + "if [[ -f \"$cfg\" ]]; then "
        + "tmp=\"$cfg.tmp.$$\"; "
        + "jq 'del(.user_number, .display, .source, .updated_at)' \"$cfg\" > \"$tmp\"; "
        + "mv \"$tmp\" \"$cfg\"; chmod 600 \"$cfg\"; "
        + "fi",
      "omarchy-call-me-clear"
    ]
    clearProc.running = true
  }

  function send(kind) {
    var body = messageText.trim()
    if (!paired) {
      feedback = "Pair your phone in the callme app first."
      return
    }
    if (!body) {
      feedback = kind === "call" ? "Write what you want to ask." : "Write a message first."
      return
    }
    if (actionProc.running) return

    actionKind = kind
    actionOutput = ""
    feedback = kind === "call" ? "Calling… answer your phone." : "Sending…"
    var payload = kind === "call"
      ? { to: numberDigits, text: body, from: "Omarchy callme" }
      : { to: numberDigits, body: body, from: "Omarchy callme" }
    actionProc.command = [
      "curl", "-fsS", apiBase + (kind === "call" ? "/ring" : "/text"),
      "-H", "content-type: application/json",
      "--data-raw", JSON.stringify(payload)
    ]
    busy = true
    actionProc.running = true
  }

  function cancelAction() {
    if (!actionProc.running) return
    actionProc.running = false
    busy = false
    feedback = "Cancelled."
  }

  function handleActionResult(exitCode) {
    busy = false
    if (exitCode !== 0) {
      feedback = "The request failed. Check your connection and pairing."
      return
    }

    var parsed = null
    try { parsed = JSON.parse(actionOutput || "{}") } catch (e) {}
    if (actionKind === "call" && parsed && parsed.transcript) {
      feedback = "Answer: " + String(parsed.transcript)
    } else if (actionKind === "call") {
      feedback = "Call finished."
    } else {
      feedback = "Text sent."
    }
    messageText = ""
  }

  function copyToClipboard(value) {
    var text = String(value || "")
    if (text === "") return
    Quickshell.execDetached(["bash", "-c", "printf %s " + Util.shellQuote(text) + " | wl-copy"])
    copyNotice = "Copied to clipboard"
    copyNoticeTimer.restart()
  }

  function aiPrompt() {
    return "My callme number is " + numberDisplay + ". Use callme when you need my answer, and never expose this number publicly."
  }

  function localCodexInstructions() {
    return "Codex CLI (local; reads ~/.aiphone/config.json automatically):\n"
      + "# Run this from your local call-me checkout:\n"
      + "cd /path/to/call-me\n"
      + "codex mcp remove call-me\n"
      + "codex mcp add callme -- node \"$PWD/codex/mcp.mjs\"\n"
      + "codex mcp list"
  }

  function claudeCodeInstructions() {
    return "Claude Code (hosted MCP):\n"
      + "claude mcp add --transport http call-me " + mcpEndpoint()
      + "\n\nHosted MCP cannot read this computer's ~/.aiphone/config.json. Provide your app number separately."
  }

  function geminiInstructions() {
    return "Gemini CLI (hosted MCP):\n"
      + "gemini mcp add --transport http call-me " + mcpEndpoint()
      + "\n\nHosted MCP cannot read this computer's ~/.aiphone/config.json. Provide your app number separately."
  }

  function openCodeInstructions() {
    return "OpenCode — add this to opencode.json (or ~/.config/opencode/opencode.json):\n"
      + "{\n"
      + "  \"mcp\": {\n"
      + "    \"call-me\": {\n"
      + "      \"type\": \"remote\",\n"
      + "      \"url\": \"" + mcpEndpoint() + "\",\n"
      + "      \"enabled\": true\n"
      + "    }\n"
      + "  }\n"
      + "}\n\nProvide your app number separately."
  }

  function cursorInstructions() {
    return "Cursor — add this to ~/.cursor/mcp.json (or .cursor/mcp.json in a project):\n"
      + "{\n"
      + "  \"mcpServers\": {\n"
      + "    \"call-me\": { \"url\": \"" + mcpEndpoint() + "\" }\n"
      + "  }\n"
      + "}\n\nProvide your app number separately."
  }

  function chatGptInstructions() {
    return "ChatGPT:\n"
      + "Settings → Apps → Advanced → Developer mode → add a connector with this URL (no authentication):\n"
      + mcpEndpoint()
      + "\n\nProvide your app number separately."
  }

  function claudeAiInstructions() {
    return "claude.ai:\n"
      + "Settings → Connectors → Add custom connector → use this URL:\n"
      + mcpEndpoint()
      + "\n\nProvide your app number separately."
  }

  function hostedMcpInstructions() {
    return "Other MCP clients:\n"
      + "Add a streamable-HTTP server pointing at:\n"
      + mcpEndpoint()
      + "\n\nHosted MCP cannot read this computer's ~/.aiphone/config.json. Provide your app number through the client's pairing or configuration flow."
  }

  function aiInstructions() {
    return "Give this to your AI:\n" + aiPrompt()
      + "\n\nFor this computer, use the local MCP so the paired number is found automatically:\n"
      + localCodexInstructions()
      + "\n\n" + claudeCodeInstructions()
      + "\n\n" + geminiInstructions()
      + "\n\n" + openCodeInstructions()
      + "\n\n" + cursorInstructions()
      + "\n\n" + chatGptInstructions()
      + "\n\n" + claudeAiInstructions()
      + "\n\n" + hostedMcpInstructions()
      + "\n\ncurl — ring:\n" + curlCommand("call")
      + "\n\ncurl — text:\n" + curlCommand("text")
  }

  function mcpEndpoint() {
    return apiBase + "/mcp"
  }

  function curlCommand(kind) {
    var payload = kind === "call"
      ? { to: numberDigits, text: "Should I deploy to prod?", from: "Your AI" }
      : { to: numberDigits, body: "Your agent finished.", from: "Your AI" }
    return "curl -sS " + apiBase + (kind === "call" ? "/ring" : "/text")
      + " \\\n  -H 'content-type: application/json' \\\n  -d '" + JSON.stringify(payload) + "'"
  }

  Timer {
    id: selectionCopyTimer
    interval: 250
    repeat: false
    onTriggered: {
      var selected = root.pendingSelectionText
      root.pendingSelectionText = ""
      if (selected.length > 0) root.copyToClipboard(selected)
    }
  }

  Timer {
    id: copyNoticeTimer
    interval: 1800
    repeat: false
    onTriggered: root.copyNotice = ""
  }

  Process {
    id: numberProc
    command: ["jq", "-r", ".user_number // \"\"", root.configPath]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var n = String(text || "").trim().replace(/\D/g, "")
        if (n.length === 10) {
          root.paired = true
          root.numberDigits = n
          root.numberDisplay = root.displayNumber(n)
          root.statusText = "Paired: " + root.numberDisplay
        }
      }
    }
    onExited: function(exitCode) {
      if (exitCode !== 0 || !root.paired) {
        root.paired = false
        root.statusText = "Not paired yet"
      }
    }
  }

  Process {
    id: pairProc
    onExited: function(exitCode) {
      root.busy = false
      if (exitCode !== 0) {
        root.feedback = "Could not save the number. Check that jq is installed."
        return
      }
      root.pairNumberText = ""
      root.pairingMode = false
      root.confirmClear = false
      root.feedback = "Paired locally. Send a test text before making a call."
      root.refresh()
    }
  }

  Process {
    id: clearProc
    onExited: function(exitCode) {
      root.busy = false
      root.confirmClear = false
      if (exitCode !== 0) {
        root.feedback = "Could not clear the saved pairing."
        return
      }
      root.pairingMode = false
      root.testControlsVisible = false
      root.feedback = "Pairing cleared from this computer."
      root.refresh()
    }
  }

  Process {
    id: actionProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.actionOutput = String(text || "").trim()
    }
    stderr: StdioCollector { waitForEnd: true }
    onExited: function(exitCode) { root.handleActionResult(exitCode) }
  }

  PanelWindow {
    id: window
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: Qt.rgba(0, 0, 0, 0.60)
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.namespace: "radres-call-me"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.textEditorFocused()
      onMoveRequested: function(dx, dy) {
        if (dy !== 0) root.moveNavigation(dy > 0 ? 1 : -1)
        else if (dx > 0) root.expandNavigation()
        else root.shrinkNavigation()
      }
      onActivateRequested: root.activateNavigation()
      onTabRequested: function(direction) { root.moveNavigation(direction) }
      MouseArea { anchors.fill: parent; onClicked: root.dismiss() }

      Rectangle {
        id: card
        anchors.centerIn: parent
        width: Math.min(parent.width - Style.space(24), Style.space(560))
        height: Math.min(parent.height - Style.space(24), body.implicitHeight + header.height + footer.height + Style.space(72))
        radius: Style.cornerRadius * 1.5
        color: Color.background
        border.width: 1
        border.color: Color.muted
        MouseArea { anchors.fill: parent; onClicked: {} }

        RowLayout {
          id: header
          anchors { top: parent.top; left: parent.left; right: parent.right; margins: Style.space(20) }
          spacing: Style.space(12)
          ColumnLayout {
            spacing: Style.space(2)
            Layout.fillWidth: true
            Text { text: "/call-me"; color: Color.foreground; font.family: Style.font.family; font.pixelSize: Style.font.title; font.bold: true }
            Text {
              text: "Is your server down at night? Get your agent to call you. Flat $5 fee, infinite calls with the /call-me app. Calls have never been easier than just making an HTTP request."
              color: Color.foreground; opacity: 0.65
              font.family: Style.font.family; font.pixelSize: Style.font.bodySmall
              wrapMode: Text.WordWrap; Layout.fillWidth: true
            }
          }
          Button {
            id: closeButton
            focusable: true
            selected: root.navItem === closeButton
            text: "Close"
            onClicked: root.dismiss()
            Accessible.name: "Close callme"
          }
        }

        Flickable {
          id: scroll
          anchors { top: header.bottom; bottom: footer.top; left: parent.left; right: parent.right; topMargin: Style.space(20); bottomMargin: Style.space(8); leftMargin: Style.space(20); rightMargin: Style.space(12) }
          clip: true
          contentWidth: width
          contentHeight: body.implicitHeight
          boundsBehavior: Flickable.StopAtBounds
          flickableDirection: Flickable.VerticalFlick
          ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

          ColumnLayout {
            id: body
            width: scroll.width - Style.space(8)
            spacing: Style.space(12)

            Rectangle {
              Layout.fillWidth: true
              implicitHeight: pairingStatus.implicitHeight + Style.space(24)
              radius: Style.cornerRadius
              color: Qt.alpha(Color.accent, 0.09)
              ColumnLayout {
                id: pairingStatus
                anchors { left: parent.left; right: parent.right; top: parent.top; margins: Style.space(12) }
                spacing: Style.space(4)
                Text {
                  text: root.paired ? "●  Phone paired" : root.statusText
                  color: root.paired ? Color.accent : Color.foreground
                  font.family: Style.font.family; font.pixelSize: Style.font.body; font.bold: true
                  Layout.fillWidth: true; wrapMode: Text.WordWrap
                }
                Text {
                  text: root.paired ? root.numberDisplay : "Install callme on your iPhone, then enter the 10-digit number from the app."
                  color: Color.foreground; opacity: 0.7
                  font.family: Style.font.family; font.pixelSize: Style.font.bodySmall
                  Layout.fillWidth: true; wrapMode: Text.WordWrap
                }
              }
            }

            Button {
              id: getAppButton
              focusable: true;
              visible: !root.paired
              text: "Get the iPhone app"
              Layout.fillWidth: true
              onClicked: Quickshell.execDetached(["xdg-open", "https://apps.apple.com/app/id6789575165"])
            }
            ColumnLayout {
              visible: !root.paired || root.pairingMode
              Layout.fillWidth: true
              TextField {
                id: pairField
                Layout.fillWidth: true; enabled: !root.busy
                placeholderText: "10-digit app number"; text: root.pairNumberText
                inputMethodHints: Qt.ImhDigitsOnly
                onTextChanged: root.pairNumberText = text
                Keys.onReturnPressed: root.pairNumber()
              }
              Flow {
                Layout.fillWidth: true; spacing: Style.space(8)
                Button {
                  id: pairButton
                  focusable: true
                  selected: root.navItem === pairButton
                  text: "Pair number"
                  enabled: !root.busy
                  onClicked: root.pairNumber()
                }
                Button {
                  id: cancelPairButton
                  focusable: true
                  selected: root.navItem === cancelPairButton
                  visible: root.paired
                  text: "Cancel"
                  enabled: !root.busy
                  onClicked: root.pairingMode = false
                }
              }
            }

            Button {
              id: copyPromptButton
              focusable: true;
              visible: root.paired && !root.pairingMode
              text: "Copy AI prompt"; selected: root.navItem === copyPromptButton; bordered: true; Layout.fillWidth: true
              onClicked: root.copyToClipboard(root.aiPrompt())
            }
            Text {
              visible: root.paired && !root.pairingMode
              text: "Paste into your connected AI to let it reach you."
              color: Color.foreground; opacity: 0.65
              font.family: Style.font.family; font.pixelSize: Style.font.bodySmall
              Layout.fillWidth: true; wrapMode: Text.WordWrap
            }

            Button {
              id: connectButton
              focusable: true;
              visible: root.paired
              leftAlign: true
              selected: root.navItem === connectButton
              text: (root.setupVisible ? "▾  " : "▸  ") + "Connect your AI"
              Layout.fillWidth: true
              onClicked: root.setupVisible = !root.setupVisible
            }
            ColumnLayout {
              visible: root.paired && root.setupVisible
              Layout.fillWidth: true
              spacing: Style.space(8)
              Repeater {
                id: connectionSections
                model: [
                  { title: "Local Codex", instructions: root.localCodexInstructions() },
                  { title: "Claude Code", instructions: root.claudeCodeInstructions() },
                  { title: "Gemini CLI", instructions: root.geminiInstructions() },
                  { title: "OpenCode", instructions: root.openCodeInstructions() },
                  { title: "Cursor", instructions: root.cursorInstructions() },
                  { title: "ChatGPT", instructions: root.chatGptInstructions() },
                  { title: "claude.ai", instructions: root.claudeAiInstructions() },
                  { title: "Other MCP clients", instructions: root.hostedMcpInstructions() },
                  { title: "HTTP examples", instructions: root.curlCommand("call") + "\n\n" + root.curlCommand("text") }
                ]
                delegate: ColumnLayout {
                  id: section
                  required property var modelData
                  property bool expanded: false
                  property var navToggle: sectionToggle
                  property var navCopy: copySectionButton
                  property var navEditor: instructionsField
                  Layout.fillWidth: true
                  Button {
                    id: sectionToggle
                    focusable: true
                    selected: root.navItem === sectionToggle
                    leftAlign: true
                    text: (section.expanded ? "−  " : "+  ") + section.modelData.title
                    Layout.fillWidth: true
                    onClicked: section.expanded = !section.expanded
                  }
                  TextEdit {
                    id: instructionsField
                    visible: section.expanded
                    text: section.modelData.instructions
                    readOnly: true; selectByMouse: true; persistentSelection: true
                    textFormat: TextEdit.PlainText; wrapMode: TextEdit.Wrap
                    color: Color.foreground
                    font.family: Style.font.family; font.pixelSize: Style.font.bodySmall
                    Layout.fillWidth: true
                    onSelectedTextChanged: {
                      if (selectedText.length > 0) {
                        root.pendingSelectionText = selectedText
                        selectionCopyTimer.restart()
                      } else {
                        root.pendingSelectionText = ""
                        selectionCopyTimer.stop()
                      }
                    }
                  }
                  Button {
                    id: copySectionButton
                    focusable: true
                    selected: root.navItem === copySectionButton
                    visible: section.expanded
                    text: "Copy " + section.modelData.title
                    onClicked: root.copyToClipboard(section.modelData.instructions)
                  }
                }
              }
            }

            Button {
              id: testButton
              focusable: true;
              visible: root.paired
              leftAlign: true
              selected: root.navItem === testButton
              text: (root.testControlsVisible ? "▾  " : "▸  ") + "Test calls"
              Layout.fillWidth: true
              onClicked: root.testControlsVisible = !root.testControlsVisible
            }
            ColumnLayout {
              visible: root.paired && root.testControlsVisible
              Layout.fillWidth: true
              TextField {
                id: messageField
                Layout.fillWidth: true; enabled: !root.busy
                placeholderText: "Write a test message or question"
                text: root.messageText; onTextChanged: root.messageText = text
                Keys.onReturnPressed: root.send("text")
              }
              Flow {
                Layout.fillWidth: true; spacing: Style.space(8)
                Button {
                  id: textButton
                  focusable: true
                  selected: root.navItem === textButton
                  text: "Text me"
                  enabled: !root.busy
                  onClicked: root.send("text")
                }
                Button {
                  id: callButton
                  focusable: true
                  selected: root.navItem === callButton
                  text: "Call me"
                  enabled: !root.busy
                  onClicked: root.send("call")
                }
                Button {
                  id: cancelActionButton
                  focusable: true
                  selected: root.navItem === cancelActionButton
                  visible: root.busy
                  text: "Cancel"
                  onClicked: root.cancelAction()
                }
              }
            }

            Button {
              id: manageButton
              focusable: true;
              visible: root.paired
              leftAlign: true
              selected: root.navItem === manageButton
              text: (root.manageVisible ? "▾  " : "▸  ") + "Manage phone"
              Layout.fillWidth: true
              onClicked: { root.manageVisible = !root.manageVisible; root.confirmClear = false }
            }
            Flow {
              visible: root.paired && root.manageVisible
              Layout.fillWidth: true; spacing: Style.space(8)
              Button {
                id: copyNumberButton
                focusable: true
                selected: root.navItem === copyNumberButton
                text: "Copy number"
                onClicked: root.copyToClipboard(root.numberDisplay)
              }
              Button {
                id: pairAgainButton
                focusable: true
                selected: root.navItem === pairAgainButton
                text: "Pair again"
                enabled: !root.busy
                onClicked: root.enterPairingMode()
              }
              Button {
                id: clearButton
                focusable: true
                selected: root.navItem === clearButton
                text: root.confirmClear ? "Confirm clear" : "Clear pairing"; enabled: !root.busy
                onClicked: {
                  if (root.confirmClear) root.clearPairing()
                  else { root.confirmClear = true; root.feedback = "Click Confirm clear to remove this phone's saved pairing." }
                }
              }
              Button {
                id: cancelClearButton
                focusable: true
                selected: root.navItem === cancelClearButton
                visible: root.confirmClear
                text: "Cancel"
                onClicked: { root.confirmClear = false; root.feedback = "" }
              }
            }
            Text {
              visible: root.feedback !== ""
              text: root.feedback; color: Color.foreground
              font.family: Style.font.family; font.pixelSize: Style.font.bodySmall
              Layout.fillWidth: true; wrapMode: Text.WordWrap
            }
          }
        }

        Text {
          id: footer
          anchors { left: parent.left; right: parent.right; bottom: parent.bottom; margins: Style.space(20) }
          text: root.copyNotice || "Your app number is private. Share it only with your AI."
          color: root.copyNotice ? Color.accent : Color.foreground
          opacity: root.copyNotice ? 1 : 0.55
          font.family: Style.font.family; font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }
      }
    }
  }
}

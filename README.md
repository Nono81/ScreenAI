# ScreenAI — Capture. Annotate. Ask AI.

> **Capture. Annotate. Ask any AI.** Without leaving your workflow.

ScreenAI is an open-source tool that bridges your screen with any AI. Press a shortcut, annotate what you see, and get instant help — from Claude, GPT, Gemini, Mistral, Grok, or your local Ollama.

No screenshots to upload. No copy-paste. No tab-switching. Just point and ask.

---

## ✨ Features

- **⌨️ One shortcut** — `Alt+Shift+S` captures your screen, `Alt+Shift+A` selects a region
- **🎨 Annotation tools** — Arrows, rectangles, highlights, freehand drawing, text labels
- **🤖 Multi-AI** — Claude, OpenAI GPT-4o, Gemini, Mistral, Grok, Ollama (local) — your choice
- **💬 Conversations** — Full chat history with context. Continue where you left off
- **🔗 Attach to existing conversations** — New captures join ongoing threads for full context
- **🔒 Privacy-first** — Your API keys, your data, stored locally. We never see anything
- **🌐 Chrome Extension** — Works on any website
- **🖥️ Desktop App** — Works on any app (Windows, macOS, Linux)

---

## 🚀 Quick Start

### Chrome Extension

```bash
# 1. Clone
git clone https://github.com/Nono81/ScreenAI.git
cd screenai

# 2. Install
npm install

# 3. Build
npm run build

# 4. Load in Chrome
#    → Open chrome://extensions
#    → Enable "Developer mode"
#    → Click "Load unpacked"
#    → Select the dist/ folder
```

Then:
1. Click the ScreenAI icon → **Settings** → Add your API key
2. Press `Alt+Shift+S` on any page
3. Annotate, ask, done ✨

### Desktop App (Tauri)

```bash
# Prerequisites: Rust, Node.js
# Install Tauri CLI
cargo install tauri-cli

# Build
cd desktop/src-tauri
cargo tauri build

# Or run in dev mode
cargo tauri dev
```

The app runs in your system tray. Global shortcuts work everywhere.

---

## 🎯 How It Works

```
1. You're stuck on something
2. Alt+Shift+S → Screen freezes
3. Draw an arrow pointing to the problem
4. Type: "Why isn't this working?"
5. AI sees your screen + annotations → Gives you the answer
6. Close overlay → Back to work
```

### Conversation Flow

Every capture can start a **new conversation** or **continue an existing one**.
The AI receives the full history — all previous screenshots, annotations, and messages —
so it understands the context of your problem even across multiple captures.

---

## 🤖 Supported AI Providers

| Provider | Vision | Streaming | API Key |
|----------|--------|-----------|---------|
| **Claude** (Anthropic) | ✅ | ✅ | [Get key](https://console.anthropic.com/) |
| **GPT-4o** (OpenAI) | ✅ | ✅ | [Get key](https://platform.openai.com/) |
| **Gemini** (Google) | ✅ | ✅ | [Get key](https://aistudio.google.com/) |
| **Mistral** | ✅ | ✅ | [Get key](https://console.mistral.ai/) |
| **Grok** (xAI) | ✅ | ✅ | [Get key](https://console.x.ai/) |
| **Ollama** (Local) | ✅ | ✅ | None needed |

### Using Ollama (free, local, private)

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a vision model
ollama pull llava

# ScreenAI will connect to http://localhost:11434 by default
```

---

## 🏗️ Architecture

```
screenai/
├── src/                    # Shared core (used by both extension & desktop)
│   ├── connectors/         # AI provider connectors (Claude, OpenAI, etc.)
│   ├── storage/            # IndexedDB conversations + settings
│   ├── types/              # TypeScript types
│   ├── utils/              # Markdown renderer, helpers
│   └── ui/
│       └── overlay/        # Main UI: annotation canvas + chat panel
│           ├── overlay.ts  # Main overlay controller
│           ├── annotation.ts # Canvas drawing engine
│           └── region.ts   # Region selection tool
├── desktop/                # Tauri desktop app
│   ├── src-tauri/          # Rust backend (screen capture, global hotkeys)
│   └── src/                # Desktop-specific frontend bridge
├── public/                 # Chrome extension manifest & icons
├── popup.html              # Extension popup
└── scripts/                # Build scripts
```

---

## 🛡️ License

**AGPL-3.0** — Free for personal and open-source use.

For commercial use without AGPL restrictions, a commercial license is available.
Contact: hello@getscreenai.com

---

## 🤝 Contributing

Contributions welcome! Please read our contributing guide before submitting PRs.

```bash
# Development
npm install
npm run dev        # Watch mode for extension

# Test the extension
# Load dist/ folder in chrome://extensions (Developer mode)
```

---

## 🗺️ Roadmap

- [x] Chrome extension with annotation + multi-AI chat
- [x] Desktop app (Tauri) with global hotkeys
- [x] Conversation history with context
- [ ] Voice input (Whisper)
- [ ] AI response via TTS
- [x] Firefox extension
- [ ] Export conversations (PDF, Markdown)
- [ ] Pro cloud sync
- [ ] Team features

---

**Made with ❤️ by the ScreenAI community**

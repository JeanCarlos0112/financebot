# 💰 FinanceBot - WhatsApp Financial Assistant

![Project Status](https://img.shields.io/badge/STATUS-ACTIVE-brightgreen?style=for-the-badge)
![NodeJS](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Google%20Gemini-8E75B2?style=for-the-badge&logo=googlebard&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)

---

## 📖 About the Project

This is a personal project developed to act as an **automated financial assistant** directly on WhatsApp. The system eliminates the need for manual spreadsheets by allowing users to register expenses using natural language.

Currently, the project is fully functional, integrating **Google Gemini AI** to interpret user intentions (spending, receipts, advice) and a local **SQLite** database for persistence. It features a hybrid architecture that combines AI analysis with a state-machine flow to ensure data accuracy.

**Key Features:**
* **Natural Language Entry:** "Spent 50 bucks on pizza" is automatically parsed.
* **Receipt Management:** Handles image/PDF uploads and links them to expenses.
* **Financial Advice:** Uses AI to analyze spending patterns and offer tips.

---

## 🔎 Technical Details

This application is built on an event-driven architecture using Node.js.

* **Core Interface:** `whatsapp-web.js` (Simulates a browser to interact with WhatsApp Web).
* **Intelligence:** Google Generative AI SDK (Gemini 1.5 Flash model).
* **Database:** SQLite (Zero-configuration, serverless SQL database engine).
* **State Management:** In-memory session handling to manage conversational context and multi-step data entry.

The bot implements a smart **[State Machine](https://en.wikipedia.org/wiki/Finite-state_machine)** logic: if the AI detects missing information (e.g., missing payment method), the bot automatically enters a specific state to ask the user for details before saving to the DB.

---

## 🗃️ Prerequisites

Before running this project, ensure you have the following ready:

* **[Node.js](https://nodejs.org/)**: Version 18 or higher (v20+ recommended).
* **Google AI API Key**: A valid key from [Google AI Studio](https://aistudio.google.com/).
* **Physical Phone**: A real smartphone with an active WhatsApp account is **required** to scan the QR Code and authenticate the bot session.

---

## 🗣️ How to Use

### 1. Clone the Repository
Open your terminal and run:
```bash
git clone https://github.com/JeanCarlos0112/financebot.git
cd financebot
```

### 2. Install Dependencies
Install the required packages (whatsapp-web.js, sqlite3, google-genai, etc.):
```bash
npm install
```

### 3. Configure Environment
Create a .env file in the root directory and add your Google API Key. Example configuration:
```bash
GOOGLE_AI_API_KEY=your_api_key_here
```

### 4. Run the Application
Execute the project using Node.js:
```bash
node app.js
```

### 5. Authenticate
1. The terminal will generate a QR Code.

2. Open WhatsApp on your phone.

3. Go to Linked Devices > Link a Device.

4. Scan the QR Code from the terminal.

5. Wait for the message: ✅ Cliente WhatsApp está pronto para uso!

---

## 🚧 Project Phases
- [x] Phase 1: Core Architecture & Database Setup (SQLite)

- [x] Phase 2: WhatsApp Client Integration (Send/Receive/Media)

- [x] Phase 3: AI Integration (Gemini for Intent & Extraction)

- [x] Phase 4: Contextual Memory & State Management

- [ ] Phase 5: Advanced Chart Generation (Future Roadmap)

---

🚑 Troubleshooting
* Linux/Server Environments: If running on a headless server (Ubuntu/Debian), you may need to install Chrome dependencies:
```bash
sudo apt-get install -y chromium-browser libgbm-dev
```
* Auth Issues: If the QR Code loops or fails, delete the cached session folder:
```bash
rm -rf .wwebjs_auth
```

---

## 📜 License
This project is licensed under the [MIT License](https://github.com/JeanCarlos0112/financebot/blob/main/LICENSE).
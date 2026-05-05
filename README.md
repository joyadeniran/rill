# Rill: AI-Driven Credit Infrastructure for Emerging Markets

Rill is a next-generation credit management platform designed to bridge the gap between lenders and small-scale merchants in emerging markets. By combining mobile-first field operations with Google Gemini's generative AI, Rill transforms debt collection into a disciplined, data-driven process.

## 🚀 Key Features

### 📱 Field Officer Mobile App (Expo)
- **AI Route Optimization**: Gemini analyzes merchant behavior and risk levels to suggest the most efficient daily collection routes.
- **AI Conflict Resolver**: Provides field officers with firm, professional rebuttals to merchant excuses, nudging them towards better repayment habits.
- **Live Firestore Sync**: Real-time data synchronization between field officers and the central dashboard.
- **Environmental Audits**: Structured check-ins to capture "soft data" like stock levels and market traffic.

### 📊 Lender & Admin Dashboards (Web)
- **Risk Briefing**: Generative AI summaries of daily field activity, highlighting behavioral shifts and cluster-level risks.
- **Merchant Management**: Comprehensive tracking of repayment streaks and balances.
- **GSI Sweep Simulation**: Integrated tools for managing delinquent accounts.

### 🤖 Intelligent Backend (Express)
- **Gemini Pro Integration**: High-speed, context-aware AI for route prioritization and conversational nudging.
- **Real-time API**: Efficient endpoints for mobile and web client interactions.

## 🛠️ Project Structure

```bash
├── mobile/         # Expo React Native App (Field Officers)
├── src/            # Vite + React Web App (Lenders & Admin)
├── server.js       # Express Backend with Gemini AI
└── metadata.json   # Project Metadata
```

## 🚦 Getting Started

### Prerequisites
- Node.js (v18+)
- Firebase Project (Authentication & Firestore)
- Google Gemini API Key

### Installation

1. **Clone and Install Root & Web Dependencies:**
   ```bash
   npm install
   ```

2. **Install Mobile Dependencies:**
   ```bash
   cd mobile
   npm install
   cd ..
   ```

3. **Environment Setup:**
   Create a `.env` file in the root and in the `mobile` directory using the provided `.env.example` templates.
   
   **Root `.env`:**
   ```env
   GEMINI_API_KEY=your_key_here
   PORT=3001
   ```

4. **Run the Development Environment:**
   ```bash
   npm run dev
   ```
   *This starts both the Vite web app and the Express AI server.*

5. **Start the Mobile App:**
   ```bash
   cd mobile
   npm run start
   ```

## 📄 License

Apache-2.0

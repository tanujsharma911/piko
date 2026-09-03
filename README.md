# Piko

<p align="center">
  <strong>AI-powered shopping assistant for Swiggy Instamart</strong>
</p>

<div>
  <img src="https://img.shields.io/badge/AI-Gemini-4285F4?style=for-the-badge&logo=google-gemini&logoColor=white" alt="Gemini" />
  <img src="https://img.shields.io/badge/Commerce-Swiggy%20Instamart-FF6B00?style=for-the-badge&logo=swiggy&logoColor=white" alt="Swiggy Instamart" />
  <img src="https://img.shields.io/badge/Payments-UPI%20%7C%20COD-16A34A?style=for-the-badge&logo=upi&logoColor=white" alt="Payments" />
  <img src="https://img.shields.io/badge/Real--time-SSE-7C3AED?style=for-the-badge&logo=server-sent-events&logoColor=white" alt="SSE" />
  <img src="https://img.shields.io/badge/Database-MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Frontend-React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
</div>

<br/>

<div align="center">

<img src="https://github.com/user-attachments/assets/360cf14a-5c6c-44fd-8e22-a16352fa19ac" alt="Piko Demo" width="850">

<br/><br/>

**Chat with Piko. Find groceries. Confirm. Pay. Track.**

</div>

Piko turns a simple conversation into a real Swiggy Instamart order.  
Users can search products, build a cart, complete checkout and follow their order without navigating through multiple screens.

## How It Works

```text
                       ┌──────────────┐
                       │    User      │
                       └──────┬───────┘
                              │
                        "Buy groceries"
                              │
                              ▼
                    ┌────────────────────┐
                    │   Piko / Gemini    │
                    │   AI Buyer         │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Piko Commerce      │
                    │ Policy Layer       │
                    │                    │
                    │ • spending limit   │
                    │ • confirmation     │
                    │ • validation       │
                    │ • idempotency      │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Swiggy Instamart   │
                    │ MCP                │
                    └─────────┬──────────┘
                              │
             ┌────────────────┼────────────────┬───────────────────┐
             ▼                ▼                ▼                   ▼
          Catalog            Cart           Checkout         Order Tracking
                                               │
                                               ▼
                                        Swiggy Payment
                                               │
                                       ┌───────┴────────┐
                                       ▼                ▼
                                      UPI              COD
                                       │
                                    QR Code
                                       │
                                       ▼
                              User's phone / UPI
                                       │
                                       ▼
                                 Real order
```

## Example

> **User:** I need bread under ₹100.

Piko searches live products → builds the cart → shows checkout → asks for confirmation → places the order.

## Features

| Feature | Description |
|---|---|
| Conversational Shopping | Find and buy products using natural language |
| Live Product Data | Uses real Swiggy products, prices and availability |
| Safe Checkout | Validates cart, amount and user confirmation |
| UPI + COD | Supports UPI QR and Cash on Delivery |
| Order Management | Tracks orders with MongoDB |
| Real-time Tracking | Streams delivery status and ETA using SSE |
| Audit Trail | Records AI tool calls and payment events |

## Safe Agentic Commerce

The AI decides **what action is needed**. The backend decides **whether that action is allowed**.

- Explicit confirmation before checkout
- Per-order spending limit
- Live cart validation
- Time-limited checkout authorization
- Duplicate checkout protection
- Payment and tool-call audit trail

## Real-time Tracking

Piko uses Server-Sent Events to continuously send order updates to the frontend.

```text
Swiggy
   │
   ▼
Backend
   │
   │ SSE
   ▼
React
   ├── Status
   ├── ETA
   └── Map
```

> Delivery status and ETA tracking are working. Rider-location data is currently being validated against Swigy's real API responses.

## Tech Stack

| Technology | Purpose |
|---|---|
| React + Vite | Frontend |
| Node.js + Express | Backend |
| Google Gemini | AI agent |
| Swiggy Instamart MCP | Commerce |
| MongoDB + Mongoose | Database |
| Server-Sent Events | Real-time updates |
| Leaflet | Tracking map |
| Razorpay | Payment integration |
| pnpm + Turborepo | Monorepo |

## Project Structure

```text
apps/
├── api/              # Backend, AI agent & commerce logic
├── web/              # React frontend
└── packages/
    └── db/           # MongoDB models
```

## Getting Started

### Requirements

- Node.js 24+
- pnpm 11+
- MongoDB
- Gemini API key
- Swiggy Builders API key

### Setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm start
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:3535`

See `apps/api/.env.example` for the required environment variables.

## Engineering Highlights

- AI agent with tool-based commerce
- Backend-controlled payment and checkout flow
- Idempotent order protection
- SSE-based real-time tracking
- Raw third-party API observability

## Roadmap

- [ ] Confirm live rider-location source
- [ ] Order cancellation
- [ ] Expand beyond Instamart
- [ ] Production deployment and logging



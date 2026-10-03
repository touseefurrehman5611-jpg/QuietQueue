# QuietQueue

Smart queue management without standing in line.

## Features

- Join queue with name (and optional phone)
- Live queue position and predicted wait time
- Staff dashboard to call next, mark done, or cancel visitors
- Real-time updates using Supabase Realtime
- Simulate visitors for demo
- Service speed control
- Alerts when visitor is close to their turn
- Average wait time and stats

## Tech Stack

- Frontend: Next.js 16 (App Router), TypeScript, Tailwind CSS
- Backend: Next.js API routes
- Database: Supabase (PostgreSQL) with Realtime
- AI: Claude API (for friendly messages)
- Alerts: Browser Notifications API
- Deployment: Vercel

## Setup

1. Clone the repository
2. Install dependencies:
   \\\ash
   npm install
   \\\
3. Copy \.env.example\ to \.env.local\ and fill in your credentials:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY
   - CLAUDE_API_KEY (optional)
4. Set up Supabase database:
   - Create a new Supabase project
   - Run the SQL schema from \supabase-schema.sql\ in the SQL Editor
5. Run the development server:
   \\\ash
   npm run dev
   \\\

## Usage

- Visit \http://localhost:3000\ for the home page
- Click "Join as Visitor" to join the queue
- Click "Staff Dashboard" to manage the queue
- Use "Simulate Visitors" in staff dashboard for demo

## Demo Flow

1. Staff clicks "Simulate Visitors"
2. Visitors join via their phones
3. Staff calls next visitors
4. Watch predictions update in real-time
5. Get alerts when 3 places away

## Environment Variables

See \.env.example\ for all required environment variables.

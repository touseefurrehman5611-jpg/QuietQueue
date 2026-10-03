import express from 'express'
import { createClient } from '@supabase/supabase-js'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const app = express()

app.use(cors())
app.use(express.json())

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'QuietQueue API is running'
  })
})

// Simulate Visitor
app.post('/api/demo/simulate', async (req, res) => {
  try {
    const queueId = 'ef5a0f5a-3777-4586-b9b5-982a2804ae39'

    // Get the highest token number
    const { data: lastVisitor, error: lastError } = await supabase
      .from('visitors')
      .select('token_number')
      .eq('queue_id', queueId)
      .order('token_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastError) {
      throw lastError
    }

    const nextToken = (lastVisitor?.token_number || 0) + 1

    // Random demo visitor name
    const names = [
      'Demo Visitor',
      'Test Visitor',
      'New Visitor',
      'Demo User'
    ]

    const name = names[Math.floor(Math.random() * names.length)]

    // Add visitor
    const { data: visitor, error: visitorError } = await supabase
      .from('visitors')
      .insert({
        queue_id: queueId,
        name: name,
        token_number: nextToken,
        status: 'waiting'
      })
      .select()
      .single()

    if (visitorError) {
      throw visitorError
    }

    // Record service event
    const { error: eventError } = await supabase
      .from('service_events')
      .insert({
        queue_id: queueId,
        visitor_id: visitor.id,
        event_type: 'joined'
      })

    if (eventError) {
      throw eventError
    }

    // Send success response
    res.json({
      success: true,
      message: 'Visitor simulated successfully',
      visitor: visitor
    })

  } catch (error) {
    console.error('Simulation error:', error)

    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})

// Start Server
const PORT = 3000

app.listen(PORT, () => {
  console.log(`QuietQueue API running at http://localhost:${PORT}`)
})
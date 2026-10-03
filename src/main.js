import './style.css'
import { supabase } from './supabase.js'

document.querySelector('#app').innerHTML = `
  <div class="container">

    <header>
      <h1>QuietQueue</h1>
      <p>Smart Queue Management System</p>
    </header>

    <section class="queue-card">
      <div>
        <h2>General Service</h2>
        <p>Status: <span class="active">Active</span></p>
      </div>

      <button id="simulateBtn">Simulate Visitor</button>
    </section>

    <section class="stats">
      <div class="stat-card">
        <h3 id="currentNumber">0</h3>
        <p>Current Number</p>
      </div>

      <div class="stat-card">
        <h3 id="waitingCount">0</h3>
        <p>Waiting Visitors</p>
      </div>
    </section>

    <section class="visitors">
      <h2>Visitors</h2>
      <div id="visitorList">Loading...</div>
    </section>

  </div>
`

const queueId = 'ef5a0f5a-3777-4586-b9b5-982a2804ae39'

async function loadVisitors() {
  const { data, error } = await supabase
    .from('visitors')
    .select('*')
    .eq('queue_id', queueId)
    .order('token_number', { ascending: true })

  if (error) {
    console.error('Load visitors error:', error)

    document.querySelector('#visitorList').textContent =
      'Unable to load visitors.'

    return
  }

  document.querySelector('#waitingCount').textContent = data.length

  document.querySelector('#visitorList').innerHTML = data.map(visitor => `
    <div class="visitor">
      <span>
        <strong>${visitor.name}</strong>
        <small>Token #${visitor.token_number}</small>
      </span>

      <span class="status">${visitor.status}</span>
    </div>
  `).join('')
}

// Initial visitor load
loadVisitors()

// Simulate Visitor
document.querySelector('#simulateBtn').addEventListener('click', async () => {

  const button = document.querySelector('#simulateBtn')

  button.disabled = true
  button.textContent = 'Adding Visitor...'

  try {

    const response = await fetch('http://localhost:3000/api/demo/simulate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    const result = await response.json()

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Unable to simulate visitor')
    }

    console.log('New visitor:', result.visitor)

    await loadVisitors()

  } catch (error) {

    console.error('Simulation error:', error)

    alert('Unable to add visitor. Please check the backend server.')

  } finally {

    button.disabled = false
    button.textContent = 'Simulate Visitor'

  }
})

// Supabase Realtime
supabase
  .channel('quietqueue-visitors')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'visitors',
      filter: `queue_id=eq.${queueId}`
    },
    payload => {
      console.log('Realtime update:', payload)
      loadVisitors()
    }
  )
  .subscribe()
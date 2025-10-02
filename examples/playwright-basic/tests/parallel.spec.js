import { test, expect } from '@playwright/test'
import { Client } from 'ephemeral-broker'

let client

test.beforeAll(async () => {
  client = new Client(process.env.EPHEMERAL_PIPE, {
    secret: process.env.EPHEMERAL_SECRET || 'test-secret',
    allowNoTtl: true
  })

  // Verify broker connectivity
  await client.ping()
})

test.describe('Parallel Browser Tests', () => {
  test('should get unique browser profiles for each worker', async ({ page, browser }) => {
    const workerId = `worker-${browser.browserType().name()}-${Date.now()}`

    // Lease unique profile ID
    const profileId = await client.lease('browser-profiles', workerId, 60000)

    console.log(`${workerId} using profile ${profileId}`)

    // Navigate with unique profile
    await page.goto('https://example.com')
    await expect(page).toHaveTitle(/Example Domain/)

    // Store test result
    await client.set(`profile-${profileId}-result`, {
      workerId,
      profileId,
      url: page.url(),
      success: true
    })

    // Release profile
    await client.release(workerId)

    expect(profileId).toBeGreaterThanOrEqual(1)
    expect(profileId).toBeLessThanOrEqual(10)
  })

  test('should share session cookies across workers', async ({ page }) => {
    // Try to get existing session
    let sessionCookie
    try {
      sessionCookie = await client.get('session-cookie')
    } catch {
      // First worker creates the session
      sessionCookie = {
        name: 'session_id',
        value: `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        domain: 'example.com',
        path: '/'
      }
      await client.set('session-cookie', sessionCookie)
      console.log('Created shared session:', sessionCookie.value)
    }

    console.log('Using shared session:', sessionCookie.value)

    // All workers use the same session
    await page.context().addCookies([sessionCookie])
    await page.goto('https://example.com')

    expect(sessionCookie.value).toMatch(/^sess_/)
  })

  test('should coordinate API rate limits', async ({ request }) => {
    const workerId = `worker-api-${Date.now()}`

    // Get rate limit counter
    const callNumber = await client.lease('api-rate-limit', workerId, 5000)

    console.log(`Worker ${workerId} - API call #${callNumber}`)

    // Simulate rate-limited API call
    const response = await request.get('https://api.github.com/zen')
    expect(response.ok()).toBeTruthy()

    // Release counter
    await client.release(workerId)

    expect(callNumber).toBeGreaterThan(0)
  })

  test('should share test fixtures across parallel runs', async ({ page }) => {
    // First worker loads fixture
    let testData
    try {
      testData = await client.get('test-fixture')
    } catch {
      testData = {
        users: ['alice', 'bob', 'charlie'],
        apiUrl: 'https://example.com/api',
        timeout: 5000
      }
      await client.set('test-fixture', testData)
      console.log('Loaded test fixture')
    }

    // All workers use the same fixture
    console.log('Using test data:', testData.users)

    await page.goto(testData.apiUrl)

    expect(testData.users).toHaveLength(3)
    expect(testData.timeout).toBe(5000)
  })
})

test.describe('Browser Context Isolation', () => {
  test('should isolate state between parallel contexts', async ({ page }) => {
    const workerId = `context-${Math.random().toString(36).substr(2, 9)}`

    // Each context gets its own state
    await client.set(`context-${workerId}`, {
      workerId,
      isolated: true,
      timestamp: Date.now()
    })

    // Verify isolation
    const myState = await client.get(`context-${workerId}`)
    expect(myState.workerId).toBe(workerId)
    expect(myState.isolated).toBe(true)

    await page.goto('https://example.com')
  })
})

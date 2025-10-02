#!/usr/bin/env node

import { Broker, Client } from '../src/index.js'
import os from 'node:os'

function calculatePercentile(sortedArray, percentile) {
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1
  return sortedArray[index]
}

function formatNumber(num) {
  return num.toLocaleString('en-US')
}

async function benchmarkOperations(client, operation, count) {
  const latencies = []
  const start = Date.now()

  for (let i = 0; i < count; i++) {
    const opStart = Date.now()

    switch (operation) {
    case 'set':
      await client.set(`key${i}`, `value${i}`, 60000)
      break
    case 'get':
      await client.get(`key${i % 1000}`).catch(() => {}) // May not exist
      break
    case 'del':
      await client.del(`key${i % 1000}`)
      break
    case 'ping':
      await client.ping()
      break
    }

    latencies.push(Date.now() - opStart)
  }

  const duration = (Date.now() - start) / 1000
  const opsPerSec = count / duration

  latencies.sort((a, b) => a - b)

  return {
    operation,
    count,
    duration: duration.toFixed(2),
    opsPerSec: Math.round(opsPerSec),
    latency: {
      min: latencies[0],
      p50: calculatePercentile(latencies, 50),
      p95: calculatePercentile(latencies, 95),
      p99: calculatePercentile(latencies, 99),
      max: latencies[latencies.length - 1]
    }
  }
}

async function benchmarkMemory(client) {
  const startMem = process.memoryUsage()

  // Add 10,000 items
  console.log('\\nMemory Benchmark: Adding 10,000 items...')
  for (let i = 0; i < 10000; i++) {
    await client.set(`memtest${i}`, { data: 'x'.repeat(100), id: i }, 60000)
    if (i % 1000 === 0 && i > 0) {
      process.stdout.write(`  Progress: ${i}/10000\\r`)
    }
  }
  console.log('  Progress: 10000/10000 ✓')

  const endMem = process.memoryUsage()

  return {
    itemCount: 10000,
    heapUsedMB: ((endMem.heapUsed - startMem.heapUsed) / 1024 / 1024).toFixed(2),
    rssMB: ((endMem.rss - startMem.rss) / 1024 / 1024).toFixed(2),
    bytesPerItem: Math.round((endMem.heapUsed - startMem.heapUsed) / 10000)
  }
}

async function main() {
  console.log('🚀 Ephemeral Broker Performance Benchmark\\n')
  console.log('Platform:', process.platform)
  console.log('Node.js:', process.version)
  console.log('CPU:', os.cpus()[0].model)
  console.log()

  const broker = new Broker({
    debug: false,
    requireTTL: false,
    maxItems: 20000 // Allow more items for benchmark
  })
  const pipe = await broker.start()
  const client = new Client(pipe, { debug: false, allowNoTtl: true })

  console.log('Running benchmarks...\\n')

  // Warm up
  console.log('Warming up...')
  for (let i = 0; i < 100; i++) {
    await client.set(`warmup${i}`, 'value')
  }
  console.log('Warm-up complete ✓\\n')

  // Benchmark each operation
  const results = []

  console.log('Benchmarking SET operations (5000 ops)...')
  results.push(await benchmarkOperations(client, 'set', 5000))

  console.log('Benchmarking GET operations (5000 ops)...')
  results.push(await benchmarkOperations(client, 'get', 5000))

  console.log('Benchmarking DEL operations (5000 ops)...')
  results.push(await benchmarkOperations(client, 'del', 5000))

  console.log('Benchmarking PING operations (5000 ops)...')
  results.push(await benchmarkOperations(client, 'ping', 5000))

  // Memory benchmark
  const memResult = await benchmarkMemory(client)

  // Print results
  console.log('\\n' + '='.repeat(80))
  console.log('PERFORMANCE RESULTS')
  console.log('='.repeat(80))

  console.log('\\n📊 Operations Per Second:\\n')
  results.forEach(r => {
    console.log(
      `  ${r.operation.toUpperCase().padEnd(6)} ${formatNumber(r.opsPerSec).padStart(10)} ops/sec`
    )
  })

  console.log('\\n⏱️  Latency (ms):\\n')
  console.log('  Operation    Min    P50    P95    P99    Max')
  console.log('  ' + '-'.repeat(48))
  results.forEach(r => {
    console.log(
      `  ${r.operation.toUpperCase().padEnd(6)}  ` +
        `${r.latency.min.toString().padStart(5)}  ` +
        `${r.latency.p50.toString().padStart(5)}  ` +
        `${r.latency.p95.toString().padStart(5)}  ` +
        `${r.latency.p99.toString().padStart(5)}  ` +
        `${r.latency.max.toString().padStart(5)}`
    )
  })

  console.log('\\n💾 Memory Usage:\\n')
  console.log(`  Items stored:     ${formatNumber(memResult.itemCount)}`)
  console.log(`  Heap increase:    ${memResult.heapUsedMB} MB`)
  console.log(`  RSS increase:     ${memResult.rssMB} MB`)
  console.log(`  Bytes per item:   ~${formatNumber(memResult.bytesPerItem)} bytes`)

  console.log('\\n' + '='.repeat(80))

  // Generate markdown table for docs
  console.log('\\n📝 Markdown Table (for documentation):\\n')
  console.log('| Operation | Ops/sec | P50 (ms) | P95 (ms) | P99 (ms) |')
  console.log('|-----------|---------|----------|----------|----------|')
  results.forEach(r => {
    console.log(
      `| ${r.operation.toUpperCase().padEnd(9)} | ` +
        `${formatNumber(r.opsPerSec).padStart(7)} | ` +
        `${r.latency.p50.toString().padStart(8)} | ` +
        `${r.latency.p95.toString().padStart(8)} | ` +
        `${r.latency.p99.toString().padStart(8)} |`
    )
  })

  broker.stop()
  console.log('\\n✓ Benchmark complete')
}

main().catch(console.error)

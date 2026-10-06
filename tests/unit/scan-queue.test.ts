import { describe, expect, it } from 'vitest'
import { SerialQueue } from '../../src/main/scan/queue'

describe('serialized scans', () => {
  it('waits for the active scan and retains requests made while busy', async () => {
    const queue = new SerialQueue<number>()
    let release!: (n: number) => void
    const order: string[] = []
    const first = queue.enqueue(async () => {
      order.push('first')
      return new Promise<number>((resolve) => { release = resolve })
    })
    const second = queue.enqueue(async () => { order.push('second'); return 2 })
    await Promise.resolve()
    expect(order).toEqual(['first'])
    release(1)
    expect(await first).toBe(1)
    expect(await second).toBe(2)
    expect(order).toEqual(['first', 'second'])
  })
  it('settles cancellation and still runs the next scan', async () => {
    const queue = new SerialQueue<string>()
    const first = queue.enqueue((signal) => new Promise<string>((resolve) => {
      signal.addEventListener('abort', () => resolve('cancelled'))
    }))
    const second = queue.enqueue(async () => 'done')
    await Promise.resolve()
    queue.cancel()
    expect(await first).toBe('cancelled')
    expect(await second).toBe('done')
  })
  it('continues after worker failure and rejects queued work on shutdown', async () => {
    const queue = new SerialQueue<string>()
    const failed = queue.enqueue(async () => { throw new Error('Worker failure') })
    const next = queue.enqueue(async () => 'done')
    await expect(failed).rejects.toThrow('Worker failure')
    expect(await next).toBe('done')
    const closed = new SerialQueue<string>()
    const active = closed.enqueue((signal) => new Promise<string>((resolve) => {
      signal.addEventListener('abort', () => resolve('cancelled'))
    }))
    const pending = closed.enqueue(async () => 'never')
    const rejected = expect(pending).rejects.toThrow('shutting down')
    await Promise.resolve()
    closed.shutdown()
    await rejected
    expect(await active).toBe('cancelled')
    await expect(closed.enqueue(async () => 'never')).rejects.toThrow('shutting down')
  })
})

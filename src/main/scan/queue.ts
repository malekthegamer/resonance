/** Serial work with explicit cancellation; queued jobs never disappear on busy. */
export class SerialQueue<T> {
  private jobs: Array<{ run(signal: AbortSignal): Promise<T>; resolve(value: T): void; reject(error: unknown): void }> = []
  private active: AbortController | null = null
  private closed = false

  get busy(): boolean { return this.active !== null || this.jobs.length > 0 }

  enqueue(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Scanning is shutting down'))
    return new Promise<T>((resolve, reject) => {
      this.jobs.push({ run, resolve, reject })
      this.pump()
    })
  }

  cancel(): void { this.active?.abort() }

  shutdown(): void {
    this.closed = true
    this.cancel()
    for (const job of this.jobs.splice(0)) job.reject(new Error('Scanning is shutting down'))
  }

  private pump(): void {
    if (this.active || this.closed) return
    const job = this.jobs.shift()
    if (!job) return
    const controller = new AbortController()
    this.active = controller
    void Promise.resolve().then(() => job.run(controller.signal)).then(job.resolve, job.reject).finally(() => {
      this.active = null
      this.pump()
    })
  }
}

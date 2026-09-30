import { createSyncScheduler } from './scheduler';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('createSyncScheduler', () => {
  it('never runs two syncs at once; a call during a run triggers exactly one more', async () => {
    const gates = [deferred(), deferred()];
    let calls = 0;
    const s = createSyncScheduler(async () => {
      await gates[calls++].promise;
    });
    const first = s.now();
    void s.now();
    void s.now(); // collapses with the previous one
    expect(calls).toBe(1);
    gates[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    gates[1].resolve();
    await first;
    expect(calls).toBe(2);
  });

  it('an error does not escape and the next call runs again', async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const s = createSyncScheduler(
      async () => {
        calls++;
        if (calls === 1) throw new Error('Network request failed');
      },
      { onError: (e) => errors.push(e) },
    );
    await expect(s.now()).resolves.toBeUndefined();
    await s.now();
    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
  });

  describe('soon()', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('waits for the debounce and collapses bursts into one sync', async () => {
      let calls = 0;
      const s = createSyncScheduler(async () => void calls++, { debounceMs: 3000 });
      s.soon();
      jest.advanceTimersByTime(2000);
      s.soon(); // another entry saved: restart the wait
      jest.advanceTimersByTime(2000);
      expect(calls).toBe(0);
      jest.advanceTimersByTime(1000);
      expect(calls).toBe(1);
    });

    it('dispose cancels a pending sync', () => {
      let calls = 0;
      const s = createSyncScheduler(async () => void calls++, { debounceMs: 3000 });
      s.soon();
      s.dispose();
      jest.advanceTimersByTime(5000);
      expect(calls).toBe(0);
    });
  });
});

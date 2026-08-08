export type FakeXeroApi = Record<string, never>;

export function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

export function fakeXeroApi(): FakeXeroApi {
  return {};
}

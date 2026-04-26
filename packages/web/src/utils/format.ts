const DAYS_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function formatHour(iso: string): string {
  const d = new Date(iso);
  return String(d.getHours());
}

export function formatDayHeader(iso: string): string {
  const d = new Date(iso);
  return `${DAYS_EN[d.getDay()]} ${d.getDate()}`;
}

export function groupHoursByDay(times: string[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  times.forEach((t, i) => {
    const key = t.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(i);
  });
  return map;
}

export type RangeMode = 'thisWeek' | 'nextWeek' | 'custom';
export interface DateRange { startDate: string; endDate: string }

export function validTimeZone(timeZone: string): boolean {
    try { new Intl.DateTimeFormat('en', { timeZone }).format(); return true; }
    catch { return false; }
}

export function validDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function dayInZone(now: Date, timeZone: string): string {
    if (!validTimeZone(timeZone)) throw new Error('Choose a valid time zone, for example Asia/Shanghai.');
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => parts.find(value => value.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

// UTC here is a date-only arithmetic coordinate, not a schedule's actual instant.
function addDays(key: string, days: number): string {
    const date = new Date(`${key}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

export function resolveRange(mode: RangeMode, timeZone: string, now: Date = new Date(), custom?: DateRange): DateRange {
    if (!validTimeZone(timeZone)) throw new Error('Choose a valid time zone, for example Asia/Shanghai.');
    if (mode === 'custom') {
        if (!custom || !validDate(custom.startDate) || !validDate(custom.endDate)) throw new Error('Choose valid start and end dates.');
        if (custom.endDate < custom.startDate) throw new Error('End date must not be earlier than start date.');
        return custom;
    }
    const today = dayInZone(now, timeZone);
    const daysSinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const startDate = addDays(today, -daysSinceMonday + (mode === 'nextWeek' ? 7 : 0));
    return { startDate, endDate: addDays(startDate, 6) };
}

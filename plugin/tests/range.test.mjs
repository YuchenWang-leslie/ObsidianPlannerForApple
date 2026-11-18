import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRange, dayInZone, validDate, validTimeZone } from '../src/range.ts';

test('Monday week across a year boundary and next week', () => {
    const now = new Date('2027-01-01T05:00:00Z');
    assert.deepEqual(resolveRange('thisWeek', 'Asia/Shanghai', now), { startDate: '2026-12-28', endDate: '2027-01-03' });
    assert.deepEqual(resolveRange('nextWeek', 'Asia/Shanghai', now), { startDate: '2027-01-04', endDate: '2027-01-10' });
});
test('chosen zone determines the local day near midnight', () => {
    const now = new Date('2026-11-15T20:00:00Z');
    assert.equal(dayInZone(now, 'Asia/Shanghai'), '2026-11-16');
    assert.equal(dayInZone(now, 'America/New_York'), '2026-11-15');
    assert.equal(resolveRange('thisWeek', 'Asia/Shanghai', now).startDate, '2026-11-16');
    assert.equal(resolveRange('thisWeek', 'America/New_York', now).startDate, '2026-11-09');
});
test('date-only weeks stay inclusive across DST transitions', () => {
    assert.deepEqual(resolveRange('thisWeek', 'America/New_York', new Date('2026-03-08T12:00:00Z')), { startDate: '2026-03-02', endDate: '2026-03-08' });
    assert.deepEqual(resolveRange('nextWeek', 'America/New_York', new Date('2026-03-08T12:00:00Z')), { startDate: '2026-03-09', endDate: '2026-03-15' });
    assert.deepEqual(resolveRange('thisWeek', 'America/New_York', new Date('2026-11-01T12:00:00Z')), { startDate: '2026-10-26', endDate: '2026-11-01' });
});
test('custom range validates leap dates and endpoints', () => {
    assert.equal(validDate('2026-02-29'), false);
    assert.equal(validDate('2028-02-29'), true);
    assert.equal(validDate('2026-2-01'), false);
    assert.equal(validDate('2026-13-01'), false);
    assert.throws(() => resolveRange('custom', 'UTC', new Date(), { startDate: '2026-11-19', endDate: '2026-11-18' }));
    assert.throws(() => resolveRange('custom', 'UTC', new Date(), { startDate: '', endDate: '2026-11-18' }));
    assert.deepEqual(resolveRange('custom', 'UTC', new Date(), { startDate: '2026-11-18', endDate: '2026-11-18' }), { startDate: '2026-11-18', endDate: '2026-11-18' });
});
test('invalid time zones fail before any request is sent', () => {
    assert.equal(validTimeZone('not/a/zone'), false);
    assert.throws(() => resolveRange('thisWeek', 'not/a/zone'));
});

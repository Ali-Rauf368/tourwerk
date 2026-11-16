import { SearchInsight } from '../components/SearchInsight';
import { fireEvent, render, screen } from '@testing-library/react';
import { RouteMap } from '../components/RouteMap';
import { TrendChart } from '../components/TrendChart';
import { Kpi, StatusBadge } from '../components/ui';
import { clock, parseClock } from '../lib/format';

test('clock formatting round-trips', () => {
  expect(clock(485)).toBe('08:05');
  expect(clock(null)).toBe('–');
  expect(parseClock('18:30')).toBe(1110);
  expect(parseClock('nope')).toBeNaN();
});

test('status badges use readable labels', () => {
  render(<><StatusBadge status="OUT_FOR_DELIVERY" /><StatusBadge status="DELIVERED" /></>);
  expect(screen.getByText('Out for delivery')).toBeInTheDocument();
  expect(screen.getByText('Delivered')).toBeInTheDocument();
});

test('KPI tile shows value and hint', () => {
  render(<Kpi label="On time" value="96.2 %" hint="within the customer window" tone="good" />);
  expect(screen.getByText('96.2 %')).toHaveClass('text-emerald-700');
});

test('trend chart shows a tooltip for the hovered day', () => {
  const rows = [
    { day: '2026-11-14', delivered: 50, failed: 2, onTimeRate: 94.1, km: 210 },
    { day: '2026-11-15', delivered: 0, failed: 0, onTimeRate: null, km: 0 },
  ];
  const { container } = render(<TrendChart rows={rows} />);
  const hit = container.querySelectorAll('rect[fill="transparent"]');
  fireEvent.mouseEnter(hit[0]);
  expect(screen.getByText('94.1 %')).toBeInTheDocument();
  expect(screen.getByText(/Sat 14 Nov/)).toBeInTheDocument();
});

test('route map numbers stops and marks failed ones', () => {
  const { container } = render(
    <RouteMap
      depot={{ lat: 53.5378, lng: 10.0868 }}
      routes={[{ id: 'r', color: '#0d9488', stops: [{ id: 'a', lat: 53.55, lng: 10.0, status: 'DELIVERED' }, { id: 'b', lat: 53.56, lng: 9.97, status: 'FAILED' }, { id: 'c', lat: 53.57, lng: 9.95 }] }]}
    />,
  );
  expect(screen.getByRole('img', { name: 'Route map' })).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(container.querySelectorAll('circle[fill="#e11d48"]')).toHaveLength(1);
});

describe('SearchInsight', () => {
  const search = {
    iterations: 4200,
    initialKm: 250,
    trace: [
      { iteration: 0, ms: 0, bestKm: 250, unassigned: 2 },
      { iteration: 90, ms: 40, bestKm: 221.5, unassigned: 0 },
      { iteration: 3100, ms: 900, bestKm: 205, unassigned: 0 },
    ],
    operators: [
      { name: 'related', weight: 2.4, uses: 1500, newBest: 9 },
      { name: 'regret2', weight: 1.1, uses: 2100, newBest: 6 },
    ],
  };

  test('summarises the search and shows how the operators adapted', () => {
    render(<SearchInsight search={search} totalKm={205} elapsedMs={1500} />);
    expect(screen.getByText(/4,200 iterations/)).toBeInTheDocument();
    expect(screen.getByText(/−18 %/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /fell from 250.0 to 205.0 km/ })).toBeInTheDocument();
    expect(screen.getByText('Related (Shaw) removal')).toBeInTheDocument();
    expect(screen.getByText('9 / 1500')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { FleetScenarios } from '../components/FleetScenarios';
import { Track } from '../pages/Track';
import type { Tracking } from '../lib/types';
import { mockFetch } from './helpers';

const base: Tracking = {
  number: 'TW-2026-01042', status: 'OUT_FOR_DELIVERY', street: 'Osterstraße 12', postcode: '20259', city: 'Hamburg', parcels: 2, deliveryDay: '2026-11-16',
  window: { start: 540, end: 720 }, depot: { lat: 53.5378, lng: 10.0868 }, destination: { lat: 53.57, lng: 9.95 },
  completedMin: null, failReason: null, driver: 'Kemal', vehicle: { plate: 'HH-TW 101', electric: false },
  plannedEta: { start: 600, end: 630 }, stopsBefore: 4, eta: { start: 610, end: 640, risk: 'ok' }, van: null,
};

const renderTrack = () =>
  render(
    <MemoryRouter initialEntries={['/track/TW-2026-01042.sig']}>
      <Routes><Route path="/track/:token" element={<Track />} /></Routes>
    </MemoryRouter>,
  );

describe('public tracking page', () => {
  test('shows the live arrival window, stops before and progress', async () => {
    const calls = mockFetch(() => ({ body: base }));
    renderTrack();
    expect(await screen.findByText('Your parcel is on the way')).toBeInTheDocument();
    expect(screen.getByTestId('eta')).toHaveTextContent('10:10 – 10:40');
    expect(screen.getByText('4 stops before yours')).toBeInTheDocument();
    expect(screen.getByText('On the way').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText(/appears on the map once/)).toBeInTheDocument();
    expect(calls[0].url).toBe('/api/track/TW-2026-01042.sig');
  });

  test('delivered and failed states', async () => {
    mockFetch(() => ({ body: { ...base, status: 'FAILED', failReason: 'recipient_absent', eta: null } }));
    renderTrack();
    expect(await screen.findByText('Delivery attempt failed')).toBeInTheDocument();
    expect(screen.getByText(/could not reach you/)).toBeInTheDocument();
    expect(screen.getByText('Not delivered')).toBeInTheDocument();
  });

  test('an invalid link says so', async () => {
    mockFetch(() => ({ status: 404, body: { error: 'Unknown tracking link' } }));
    renderTrack();
    expect(await screen.findByRole('alert')).toHaveTextContent('This tracking link is not valid.');
  });
});

test('fleet what-if highlights the recommended fleet size', () => {
  render(
    <FleetScenarios
      onClose={() => {}}
      result={{
        day: '2026-11-17', orders: 22, recommended: 2, cost: { perVanDay: 210, perKm: 0.38, perUnassigned: 25 },
        scenarios: [
          { vans: 1, vansUsed: 1, plates: ['A'], totalKm: 80, unassigned: 6, lastReturn: 1140, utilization: 0.98, costEur: 390 },
          { vans: 2, vansUsed: 2, plates: ['A', 'B'], totalKm: 95, unassigned: 0, lastReturn: 1000, utilization: 0.6, costEur: 456 },
          { vans: 3, vansUsed: 3, plates: ['A', 'B', 'C'], totalKm: 110, unassigned: 0, lastReturn: 900, utilization: 0.45, costEur: 672 },
        ],
      }}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Recommended: 2 vans, 95 km, about €456, every order served');
  expect(screen.getByText('✓ best').closest('tr')).toHaveTextContent('€456');
});

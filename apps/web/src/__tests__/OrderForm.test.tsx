import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderForm } from '../components/OrderForm';
import { mockFetch } from './helpers';

const fill = async (fields: Record<string, string>) => {
  for (const [label, value] of Object.entries(fields)) {
    const input = screen.getByLabelText(label);
    await userEvent.clear(input);
    if (value) await userEvent.type(input, value);
  }
};

test('validates on the client before sending anything', async () => {
  const calls = mockFetch(() => ({ body: {} }));
  render(<OrderForm day="2026-11-17" onCreated={jest.fn()} onCancel={jest.fn()} />);
  await fill({ Customer: 'A', 'Street and number': 'Osterstraße 1', Postcode: '80331', 'Weight (kg)': '0' });
  await userEvent.click(screen.getByRole('button', { name: 'Create order' }));
  expect(screen.getByText('Enter the customer name')).toBeInTheDocument();
  expect(screen.getByText('Outside the service area')).toBeInTheDocument();
  expect(screen.getByText('Between 0 and 1000 kg')).toBeInTheDocument();
  expect(calls).toHaveLength(0);
});

test('rejects a delivery window shorter than 30 minutes', async () => {
  mockFetch(() => ({ body: {} }));
  render(<OrderForm day="2026-11-17" onCreated={jest.fn()} onCancel={jest.fn()} />);
  await fill({ Customer: 'Café Deichgraf', 'Street and number': 'Lange Reihe 5', Postcode: '20099', 'Weight (kg)': '4' });
  await userEvent.clear(screen.getByLabelText('Window to'));
  await userEvent.type(screen.getByLabelText('Window to'), '08:15');
  await userEvent.click(screen.getByRole('button', { name: 'Create order' }));
  expect(screen.getByText('The window must be at least 30 minutes')).toBeInTheDocument();
});

test('sends minutes after midnight and reports the created order', async () => {
  const calls = mockFetch(() => ({ status: 201, body: { id: 'o1', number: 'TW-2026-01001', deliveryDay: '2026-11-17T00:00:00.000Z' } }));
  const onCreated = jest.fn();
  render(<OrderForm day="2026-11-17" onCreated={onCreated} onCancel={jest.fn()} />);
  await fill({ Customer: 'Café Deichgraf', 'Street and number': 'Lange Reihe 5', Postcode: '20099', 'Weight (kg)': '4.5' });
  await userEvent.click(screen.getByRole('button', { name: 'Create order' }));
  await screen.findByRole('button', { name: 'Create order' });
  expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ number: 'TW-2026-01001' }));
  expect(JSON.parse(String(calls[0].init?.body))).toEqual(expect.objectContaining({ postcode: '20099', weightKg: 4.5, windowStart: 480, windowEnd: 1080, deliveryDay: '2026-11-17' }));
});

test('shows server field errors next to the field', async () => {
  mockFetch(() => ({ status: 400, body: { error: 'Invalid request', details: [{ path: 'street', message: 'Address could not be found' }] } }));
  render(<OrderForm day="2026-11-17" onCreated={jest.fn()} onCancel={jest.fn()} />);
  await fill({ Customer: 'Café Deichgraf', 'Street and number': 'Lange Reihe 5', Postcode: '20099', 'Weight (kg)': '4' });
  await userEvent.click(screen.getByRole('button', { name: 'Create order' }));
  expect(await screen.findByText('Address could not be found')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid request');
});

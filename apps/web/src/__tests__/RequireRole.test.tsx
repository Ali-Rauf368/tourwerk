import { screen } from '@testing-library/react';
import { AppRoutes } from '../App';
import { mockFetch, renderWithProviders } from './helpers';

beforeEach(() => sessionStorage.clear());

test('signed-out users are sent to the login page', async () => {
  mockFetch(() => ({ body: {} }));
  renderWithProviders(<AppRoutes />, '/dispatch');
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
});

test('drivers cannot open dispatcher pages', async () => {
  sessionStorage.setItem('tourwerk.session', JSON.stringify({ token: 't', user: { id: '2', name: 'Kemal Arslan', email: 'f', role: 'DRIVER', vehicle: { id: 'v', plate: 'HH-TW 101' } } }));
  mockFetch(() => ({ body: null }));
  renderWithProviders(<AppRoutes />, '/orders');
  expect(await screen.findByText('No tour planned for you today.')).toBeInTheDocument();
  expect(screen.getByText('HH-TW 101')).toBeInTheDocument();
});
